/**
 * Calibration worklet for sample-accurate round-trip latency measurement.
 *
 * Generates pulses on its output (→ speakers) and listens for each
 * one using sliding-window energy detection on its input (from mic).
 *
 * Energy detection: maintains a 5ms sliding sum of |sample|. During
 * each per-pulse bounded window, tracks the frame where the energy
 * sum is highest. That frame IS the pulse arrival time.
 *
 * Advantages over edge detection:
 * - Immune to threshold tuning (no threshold at all)
 * - Room echo has lower energy than direct pulse (inverse square)
 * - Noise spikes have tiny energy in 5ms window
 * - Sustain echo energy decays exponentially — pulse creates clear peak
 *
 * Messages:
 *   START: { numPulses, pulseIntervalFrames, sustainFrames }
 *   STOP:  → RESULT { generationFrames, detectedFrames, maxPeak }
 */
class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.numPulses = 5
    this.pulseIntervalFrames = 8820
    this.pulseLength = 44
    this.sustainFrames = 22050
    this.silenceFrames = Math.floor(0.2 * sampleRate)   // 200ms gap after sustain
    this.generationFrames = []
    this.pulseIndex = -1
    this.pulseCountdown = 0
    this.sustainCountdown = 0
    this.silenceCountdown = 0
    this.maxPeak = 0
    this.detectedFrames = []
    this.isWaiting = false
    this.waitStart = 0
    this.waitEnd = 0

    // Energy detection ring buffer (5ms window)
    this.energyWindow = Math.floor(0.005 * sampleRate)
    this.energyRing = new Float32Array(this.energyWindow)
    this.energyIdx = 0
    this.sumEnergy = 0
    this.maxEnergy = 0
    this.maxEnergyFrame = 0

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'START') {
        this.numPulses = data.numPulses ?? 5
        this.pulseIntervalFrames = data.pulseIntervalFrames ?? 8820
        this.sustainFrames = data.sustainFrames ?? 22050
        this.silenceFrames = Math.floor(0.2 * sampleRate)
        this.generationFrames = []
        this.detectedFrames = []
        this.pulseIndex = 0
        this.pulseCountdown = this.sustainFrames + this.silenceFrames
        this.sustainCountdown = this.sustainFrames
        this.silenceCountdown = this.silenceFrames
        this.maxPeak = 0
        this.isWaiting = false
        this.waitStart = 0
        this.waitEnd = 0
        this.maxEnergy = 0
        this.maxEnergyFrame = 0
        this.sumEnergy = 0
        this.energyIdx = 0
        this.energyRing.fill(0)
        this.port.postMessage({ type: 'DEBUG', msg: 'START received', sustainFrames: this.sustainFrames })
      } else if (data.type === 'STOP') {
        this.pulseIndex = -1
        this.port.postMessage({
          type: 'RESULT',
          generationFrames: this.generationFrames,
          detectedFrames: this.detectedFrames,
          maxPeak: this.maxPeak,
        })
      } else if (data.type === 'MEASURE_FLOOR') {
        // No threshold needed for energy detection — message is a no-op
        this.port.postMessage({ type: 'FLOOR_RESULT', peak: 0 })
      }
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]

    if (this.pulseIndex < 0) return true

    // --- Generate: sustain → silence → pulses ---
    if (output && output[0]) {
      const outData = output[0]
      for (let i = 0; i < outData.length; i++) outData[i] = 0

      // Sustain tone
      if (this.sustainCountdown > 0) {
        for (let i = 0; i < outData.length && i < this.sustainCountdown; i++) {
          const t = (currentFrame + i) / sampleRate
          outData[i] = Math.sin(2 * Math.PI * 1000 * t) * 0.4
        }
        this.sustainCountdown -= outData.length
      }

      // Silence gap (output stays 0)
      if (this.sustainCountdown <= 0 && this.silenceCountdown > 0) {
        // Output is already zeroed above
        this.silenceCountdown -= outData.length
      }

      // Generate pulse when both sustain and silence have elapsed
      if (this.sustainCountdown <= 0 && this.silenceCountdown <= 0 &&
          this.pulseCountdown <= 0 && this.pulseIndex < this.numPulses) {
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

        // Open per-pulse energy detection window
        this.isWaiting = true
        this.waitStart = pulseStartFrame + Math.floor(0.010 * sampleRate)   // 10ms blanking
        this.waitEnd = pulseStartFrame + Math.floor(0.500 * sampleRate)     // 500ms max
        this.maxEnergy = 0
        this.maxEnergyFrame = 0
        this.energyRing.fill(0)
        this.sumEnergy = 0
        this.energyIdx = 0

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

    // --- Detect: sliding-window energy peak ---
    if (input && input[0] && input[0].length > 0) {
      const inData = input[0]
      for (let i = 0; i < inData.length; i++) {
        const frame = currentFrame + i
        const absVal = Math.abs(inData[i])

        // Update global peak (diagnostics only)
        this.maxPeak = Math.max(this.maxPeak, absVal)

        // Update sliding 5ms energy sum
        const oldVal = this.energyRing[this.energyIdx]
        this.energyRing[this.energyIdx] = absVal
        this.energyIdx = (this.energyIdx + 1) % this.energyWindow
        this.sumEnergy += absVal - oldVal

        // Track energy peak within detection window
        if (this.isWaiting && frame >= this.waitStart && frame <= this.waitEnd) {
          if (this.sumEnergy > this.maxEnergy) {
            this.maxEnergy = this.sumEnergy
            this.maxEnergyFrame = frame
          }
        }

        // Close detection window — record the energy peak frame
        if (this.isWaiting && frame >= this.waitEnd) {
          this.detectedFrames.push(
            this.maxEnergyFrame > 0 ? this.maxEnergyFrame : this.waitStart
          )
          this.isWaiting = false
          this.maxEnergy = 0
          this.maxEnergyFrame = 0
        }
      }
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
