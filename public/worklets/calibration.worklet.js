/**
 * Calibration worklet for sample-accurate round-trip latency measurement.
 *
 * Generates pulses on its output (→ speakers) and listens for each
 * one within a bounded time window on its input (from mic).
 *
 * Per-pulse bounded window: each pulse opens a detection window
 * [genFrame + minLatency, genFrame + maxLatency]. The FIRST rising
 * edge within that window is the pulse arrival. This prevents cross-
 * pulse interference and false matching to sustain echo edges.
 *
 * Messages:
 *   MEASURE_FLOOR: { durationFrames } → FLOOR_RESULT
 *   START: { numPulses, pulseIntervalFrames, threshold, sustainFrames }
 *   STOP:  → RESULT { generationFrames, detectedFrames, maxPeak }
 */
class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.numPulses = 5
    this.pulseIntervalFrames = 8820
    this.pulseLength = 44
    this.threshold = 0.03
    this.sustainFrames = 22050
    this.minLatencyFrames = Math.floor(0.003 * 44100)   // 3ms
    this.maxLatencyFrames = Math.floor(0.500 * 44100)   // 500ms
    this.generationFrames = []
    this.pulseIndex = -1
    this.pulseCountdown = 0
    this.sustainCountdown = 0
    this.isMeasuringFloor = false
    this.floorCountdown = 0
    this.floorMaxAbs = 0
    this.maxPeak = 0
    this.prevAbove = false
    this.detectedFrames = []
    this.waitStart = 0
    this.waitEnd = 0
    this.isWaiting = false

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'MEASURE_FLOOR') {
        this.floorCountdown = data.durationFrames ?? 8820
        this.floorMaxAbs = 0
        this.isMeasuringFloor = true
      } else if (data.type === 'START') {
        this.numPulses = data.numPulses ?? 5
        this.pulseIntervalFrames = data.pulseIntervalFrames ?? 8820
        this.threshold = data.threshold ?? 0.03
        this.sustainFrames = data.sustainFrames ?? 22050
        this.minLatencyFrames = Math.floor(0.003 * sampleRate)
        this.maxLatencyFrames = Math.floor(0.500 * sampleRate)
        this.generationFrames = []
        this.detectedFrames = []
        this.pulseIndex = 0
        this.pulseCountdown = this.sustainFrames
        this.sustainCountdown = this.sustainFrames
        this.prevAbove = false
        this.maxPeak = 0
        this.isWaiting = false
        this.waitStart = 0
        this.waitEnd = 0
        this.port.postMessage({ type: 'DEBUG', msg: 'START received', sustainFrames: this.sustainFrames })
      } else if (data.type === 'STOP') {
        this.pulseIndex = -1
        this.port.postMessage({
          type: 'RESULT',
          generationFrames: this.generationFrames,
          detectedFrames: this.detectedFrames,
          maxPeak: this.maxPeak,
        })
      }
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]

    // --- Floor measurement ---
    if (this.isMeasuringFloor) {
      if (input && input[0] && input[0].length > 0) {
        for (let i = 0; i < input[0].length; i++) {
          this.floorMaxAbs = Math.max(this.floorMaxAbs, Math.abs(input[0][i]))
        }
        this.floorCountdown -= input[0].length
      }
      if (this.floorCountdown <= 0) {
        this.isMeasuringFloor = false
        this.port.postMessage({ type: 'FLOOR_RESULT', peak: this.floorMaxAbs })
      }
      return true
    }

    if (this.pulseIndex < 0) return true

    // --- Generate: sustain + pulses ---
    if (output && output[0]) {
      const outData = output[0]
      for (let i = 0; i < outData.length; i++) outData[i] = 0

      if (this.sustainCountdown > 0) {
        for (let i = 0; i < outData.length && i < this.sustainCountdown; i++) {
          const t = (currentFrame + i) / sampleRate
          outData[i] = Math.sin(2 * Math.PI * 1000 * t) * 0.4
        }
        this.sustainCountdown -= outData.length
      }

      if (this.pulseCountdown <= 0 && this.pulseIndex < this.numPulses) {
        const pulseStartFrame = currentFrame - this.pulseCountdown
        this.generationFrames.push(pulseStartFrame)

        const pulseOffset = -this.pulseCountdown
        for (let i = 0; i < this.pulseLength && i < outData.length; i++) {
          const t = (i + pulseOffset) / sampleRate
          const envelope = 0.5 * (1 - Math.cos(Math.PI * i / this.pulseLength))
          if (i + pulseOffset >= 0 && i + pulseOffset < outData.length) {
            outData[i + pulseOffset] = Math.sin(2 * Math.PI * 1000 * t) * envelope
          }
        }

        // Open per-pulse detection window
        this.isWaiting = true
        this.waitStart = pulseStartFrame + this.minLatencyFrames
        this.waitEnd = pulseStartFrame + this.maxLatencyFrames
        this.prevAbove = false

        this.port.postMessage({
          type: 'DEBUG',
          msg: 'Pulse generated',
          pulseIndex: this.pulseIndex,
          genFrame: pulseStartFrame,
        })

        this.pulseIndex++
        this.pulseCountdown = this.pulseIntervalFrames
      } else {
        this.pulseCountdown -= outData.length
      }
    }

    // --- Detect: per-pulse bounded window ---
    if (this.isWaiting && input && input[0] && input[0].length > 0) {
      const inData = input[0]
      // Close window if we've passed the end
      if (currentFrame >= this.waitEnd) {
        this.isWaiting = false
      } else {
        for (let i = 0; i < inData.length; i++) {
          const frame = currentFrame + i
          if (frame < this.waitStart) {
            this.prevAbove = Math.abs(inData[i]) >= this.threshold
            continue
          }
          if (frame >= this.waitEnd) {
            this.isWaiting = false
            break
          }
          this.maxPeak = Math.max(this.maxPeak, Math.abs(inData[i]))
          const isAbove = Math.abs(inData[i]) >= this.threshold

          if (isAbove && !this.prevAbove) {
            this.detectedFrames.push(frame)
            this.isWaiting = false
            this.waitStart = Infinity
            this.waitEnd = Infinity
            break
          }
          this.prevAbove = isAbove
        }
      }
    }

    // Still track maxPeak even when not waiting
    if (!this.isWaiting && input && input[0] && input[0].length > 0) {
      for (let i = 0; i < input[0].length; i++) {
        this.maxPeak = Math.max(this.maxPeak, Math.abs(input[0][i]))
      }
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
