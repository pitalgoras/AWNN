/**
 * Calibration worklet for round-trip latency measurement.
 *
 * Plays a single 100ms 1kHz burst through speakers and finds the
 * 1ms energy chunk with the highest energy on the mic input.
 * The difference between burst start and energy peak = round-trip latency.
 *
 * Messages:
 *   MEASURE_FLOOR: { durationFrames } → FLOOR_RESULT { peak }
 *   START: {} — begin calibration
 *   STOP:  → RESULT { burstStartFrame, peakFrame, maxSample, floorPeak }
 */
class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.burstStartFrame = 0
    this.peakFrame = 0
    this.maxSample = 0
    this.floorPeak = 0
    this.isCapturing = false
    this.isMeasuring = false
    this.isMeasuringFloor = false
    this.floorCountdown = 0
    this.waitStart = 0
    this.waitEnd = 0
    this.chunkSize = Math.floor(0.001 * sampleRate)  // 1ms
    this.chunkCountdown = 0
    this.chunkSum = 0
    this.maxChunkSum = 0
    this.maxChunkIdx = -1
    this.chunkIdx = 0
    this.burstDuration = Math.floor(0.100 * sampleRate)  // 100ms
    this.burstCountdown = 0

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'MEASURE_FLOOR') {
        this.floorCountdown = data.durationFrames ?? 8820
        this.floorPeak = 0
        this.isMeasuringFloor = true
      } else if (data.type === 'START') {
        this.isCapturing = false
        this.isMeasuring = true
        this.burstStartFrame = 0
        this.peakFrame = 0
        this.maxSample = 0
        this.maxChunkSum = 0
        this.maxChunkIdx = -1
        this.chunkIdx = 0
        this.chunkSum = 0
        this.chunkCountdown = this.chunkSize
        this.burstCountdown = this.burstDuration
        // Wait 100ms of silence before burst (for context)
        this.waitStart = currentFrame + this.burstDuration + Math.floor(0.010 * sampleRate)
        this.waitEnd = this.waitStart + Math.floor(0.500 * sampleRate)
        this.port.postMessage({ type: 'DEBUG', msg: 'START received' })
      } else if (data.type === 'STOP') {
        this.isMeasuring = false
        this.isCapturing = false
        this.port.postMessage({
          type: 'RESULT',
          burstStartFrame: this.burstStartFrame,
          peakFrame: this.peakFrame,
          maxSample: this.maxSample,
          floorPeak: this.floorPeak,
        })
      }
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]

    // --- Floor measurement ---
    if (this.isMeasuringFloor) {
      if (input && input[0]) {
        for (let i = 0; i < input[0].length; i++) {
          this.floorPeak = Math.max(this.floorPeak, Math.abs(input[0][i]))
        }
        this.floorCountdown -= input[0].length
      }
      if (this.floorCountdown <= 0) {
        this.isMeasuringFloor = false
        this.port.postMessage({ type: 'FLOOR_RESULT', peak: this.floorPeak })
      }
      return true
    }

    if (!this.isMeasuring) return true

    // --- Generate burst ---
    if (output && output[0]) {
      const outData = output[0]
      for (let i = 0; i < outData.length; i++) outData[i] = 0

      if (this.burstCountdown > 0) {
        const burstStart = this.burstDuration - this.burstCountdown
        // Record burst start (first sample that plays)
        if (this.burstStartFrame === 0) {
          this.burstStartFrame = currentFrame
        }
        for (let i = 0; i < outData.length && i < this.burstCountdown; i++) {
          const t = (currentFrame + i) / sampleRate
          outData[i] = Math.sin(2 * Math.PI * 1000 * t) * 0.4
        }
        this.burstCountdown -= outData.length
      }
    }

    // --- Detect energy ---
    if (input && input[0]) {
      const inData = input[0]
      for (let i = 0; i < inData.length; i++) {
        const frame = currentFrame + i
        const absVal = Math.abs(inData[i])
        this.maxSample = Math.max(this.maxSample, absVal)

        // Energy chunking (1ms windows)
        this.chunkSum += absVal
        this.chunkCountdown--
        if (this.chunkCountdown <= 0) {
          // Check if this chunk is within listening window
          if (frame >= this.waitStart && frame <= this.waitEnd) {
            if (this.chunkSum > this.maxChunkSum) {
              this.maxChunkSum = this.chunkSum
              this.maxChunkIdx = this.chunkIdx
              this.peakFrame = frame - Math.floor(this.chunkSize / 2)
            }
          }
          this.chunkSum = 0
          this.chunkCountdown = this.chunkSize
          this.chunkIdx++
        }
      }
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
