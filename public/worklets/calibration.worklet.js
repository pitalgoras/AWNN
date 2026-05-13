/**
 * Calibration worklet for sample-accurate round-trip latency measurement.
 *
 * Generates pulses on its output (→ speakers) and records ALL rising
 * edges on its input (from mic). The main thread pairs generation
 * frames with detection frames to compute latency.
 *
 * Messages:
 *   START: { numPulses, pulseIntervalFrames, threshold, sustainFrames }
 *   STOP:  → { type: 'RESULT', generationFrames, detectedFrames }
 */
class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.numPulses = 5
    this.pulseIntervalFrames = 8820
    this.pulseLength = 44               // 1ms at 44100
    this.threshold = 0.03
    this.sustainFrames = 22050          // 500ms at 44100
    this.generationFrames = []
    this.pulseIndex = -1                // -1 = not started
    this.pulseCountdown = 0
    this.sustainCountdown = 0
    this.prevAbove = false
    this.detectedFrames = []

    this.port.onmessage = (event) => {
      if (event.data.type === 'START') {
        this.numPulses = event.data.numPulses ?? 5
        this.pulseIntervalFrames = event.data.pulseIntervalFrames ?? 8820
        this.threshold = event.data.threshold ?? 0.03
        this.sustainFrames = event.data.sustainFrames ?? 22050
        this.generationFrames = []
        this.detectedFrames = []
        this.pulseIndex = 0
        this.pulseCountdown = this.sustainFrames  // sustain first
        this.sustainCountdown = this.sustainFrames
        this.prevAbove = false
        this.port.postMessage({ type: 'DEBUG', msg: 'START received', sustainFrames: this.sustainFrames })
      } else if (event.data.type === 'STOP') {
        this.pulseIndex = -1
        this.port.postMessage({
          type: 'RESULT',
          generationFrames: this.generationFrames,
          detectedFrames: this.detectedFrames,
        })
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (this.pulseIndex < 0) return true

    const input = inputs[0]
    const output = outputs[0]

    // --- Generate: sustain tone + pulses ---
    if (output && output[0]) {
      const outData = output[0]
      // Silence output by default
      for (let i = 0; i < outData.length; i++) outData[i] = 0

      // Generate sustain tone while countdown > remaining sustain
      if (this.sustainCountdown > 0) {
        for (let i = 0; i < outData.length && i < this.sustainCountdown; i++) {
          const t = (currentFrame + i) / sampleRate
          outData[i] = Math.sin(2 * Math.PI * 1000 * t) * 0.4
        }
        this.sustainCountdown -= outData.length
      }

      // Generate pulse when countdown expires
      if (this.pulseCountdown <= 0 && this.pulseIndex < this.numPulses) {
        // Detect the exact frame where the pulse starts in this quantum
        const pulseStartFrame = currentFrame - this.pulseCountdown
        this.generationFrames.push(pulseStartFrame)

        // Write a 1ms 1kHz pulse at the pulseStartOffset
        const pulseOffset = -this.pulseCountdown  // 0 to... samples into this quantum
        for (let i = 0; i < this.pulseLength && i < outData.length; i++) {
          const t = (i + pulseOffset) / sampleRate
          const envelope = 0.5 * (1 - Math.cos(Math.PI * i / this.pulseLength))
          // Only write if within this buffer
          if (i + pulseOffset >= 0 && i + pulseOffset < outData.length) {
            outData[i + pulseOffset] = Math.sin(2 * Math.PI * 1000 * t) * envelope
          }
        }

        this.port.postMessage({
          type: 'DEBUG',
          msg: 'Pulse generated',
          pulseIndex: this.pulseIndex,
          genFrame: pulseStartFrame,
          pulseCountdown: this.pulseCountdown,
        })

        this.pulseIndex++
        this.pulseCountdown = this.pulseIntervalFrames
      } else {
        this.pulseCountdown -= outData.length
      }
    }

    // --- Detect: record ALL rising edges (no isWaiting gate) ---
    if (input && input[0] && input[0].length > 0) {
      const inData = input[0]
      for (let i = 0; i < inData.length; i++) {
        const abs = Math.abs(inData[i])
        const isAbove = abs >= this.threshold

        if (isAbove && !this.prevAbove) {
          this.detectedFrames.push(currentFrame + i)
        }
        this.prevAbove = isAbove
      }
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
