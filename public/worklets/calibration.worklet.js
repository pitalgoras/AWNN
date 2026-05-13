/**
 * Calibration worklet for sample-accurate round-trip latency measurement.
 *
 * The worklet generates a short pulse on its output (routed to speakers)
 * and simultaneously listens for it on its input (from microphone).
 * By recording the exact generation frame (currentFrame at generation time)
 * and the detection frame (first sample above threshold after generation),
 * the round-trip latency can be computed as:
 *   latencyMs = (detectionFrame - generationFrame) / sampleRate * 1000
 *
 * This eliminates all room-echo and noise-gate issues because:
 * - The generation and detection use the SAME AudioContext clock
 * - Detection looks for the FIRST pulse arrival, not pattern intervals
 * - Room echoes arrive after the direct pulse and are ignored
 *
 * Messages:
 *   START: { numPulses, pulseIntervalFrames, threshold } — begin sequence
 *   STOP:  — post back results: { type: 'RESULT', latencies: number[] }
 */
class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.isRunning = false
    this.numPulses = 5
    this.pulseIntervalFrames = 8820       // 200ms at 44100
    this.pulseLength = 44                 // 1ms at 44100
    this.threshold = 0.05
    this.generationFrames = []            // currentFrame when each pulse was generated
    this.pulseIndex = -1                  // -1 = not started
    this.pulseCountdown = 0               // frames until next pulse generation
    this.isWaiting = false                // waiting to hear pulse on input
    this.prevAbove = false
    this.detectedFrames = []
    this.inputCounter = 0

    this.port.onmessage = (event) => {
      if (event.data.type === 'START') {
        this.numPulses = event.data.numPulses ?? 5
        this.pulseIntervalFrames = event.data.pulseIntervalFrames ?? 8820
        this.threshold = event.data.threshold ?? 0.05
        // First pulse at START + 0.3s to let audio path stabilize
        this.pulseCountdown = Math.floor(0.3 * sampleRate)
        this.pulseIndex = 0
        this.isRunning = true
        this.isWaiting = false
        this.generationFrames = []
        this.detectedFrames = []
        this.prevAbove = false
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'START received',
          numPulses: this.numPulses,
          pulseCountdown: this.pulseCountdown,
        })
      } else if (event.data.type === 'STOP') {
        this.isRunning = false
        this.port.postMessage({
          type: 'RESULT',
          generationFrames: this.generationFrames,
          detectedFrames: this.detectedFrames,
        })
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.isRunning) return true

    const output = outputs[0]
    const input = inputs[0]

    // --- Generate pulses on output ---
    if (output && output[0]) {
      const outData = output[0]
      // Default: silence
      for (let i = 0; i < outData.length; i++) {
        outData[i] = 0
      }

      // Check if we need to generate a pulse
      if (this.pulseIndex >= 0 && this.pulseIndex < this.numPulses) {
        this.pulseCountdown -= outData.length

        if (this.pulseCountdown <= 0 && this.pulseIndex < this.numPulses) {
          // Generate pulse at current frame
          const genFrame = currentFrame
          this.generationFrames.push(genFrame)
          this.isWaiting = true
          this.prevAbove = false

          // Write a 1ms 1kHz pulse at the START of this quantum
          const pulseLen = Math.min(this.pulseLength, outData.length)
          for (let i = 0; i < pulseLen; i++) {
            const t = i / sampleRate
            // Raised-cosine envelope for clean click
            const envelope = 0.5 * (1 - Math.cos(Math.PI * i / pulseLen))
            outData[i] = Math.sin(2 * Math.PI * 1000 * t) * envelope
          }

          this.port.postMessage({
            type: 'DEBUG',
            msg: 'Pulse generated',
            pulseIndex: this.pulseIndex,
            genFrame: genFrame,
            pulseCountdown: this.pulseCountdown,
          })

          this.pulseIndex++
          this.pulseCountdown = this.pulseIntervalFrames

          // Reset prevAbove for fresh detection
          this.isWaiting = true
          this.prevAbove = false
        }
      }
    }

    // --- Detect pulses on input ---
    if (this.isWaiting && input && input[0] && input[0].length > 0) {
      const inData = input[0]
      for (let i = 0; i < inData.length; i++) {
        const abs = Math.abs(inData[i])
        const isAbove = abs >= this.threshold

        if (isAbove && !this.prevAbove) {
          // Rising edge — this is the pulse arrival
          const detectFrame = currentFrame + i
          this.detectedFrames.push(detectFrame)
          this.isWaiting = false

          this.port.postMessage({
            type: 'DEBUG',
            msg: 'Pulse detected',
            detectFrame: detectFrame,
            inputSample: inData[i],
          })
          break
        }
        this.prevAbove = isAbove
      }
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
