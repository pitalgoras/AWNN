/**
 * Calibration worklet for round-trip latency measurement using
 * continuous looping probe (amplitude staircase) + envelope matching.
 *
 * Messages:
 *   MEASURE_FLOOR { durationFrames }
 *   FLOOR_RESULT { peak }
 *   PROBE_LOOP_START { levels, seeds, noiseFrames, silenceFrames, cycleGapFrames }
 *   PROBE_CYCLE { cycleIndex, levels, envelope, windowFrames, noiseFrames,
 *                  silenceFrames, cycleGapFrames, sampleRate }
 *   PROBE_RESULT { recording, totalFrames }
 *   STOP  — flush current loop recording
 */

function mulberry32(seed) {
  let s = seed | 0
  return function () {
    s = s + 0x6d2b79f5 | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generateNoise(seed, length, amplitude) {
  if (amplitude === undefined) amplitude = 0.3
  const rng = mulberry32(seed)
  const buf = new Float32Array(length)
  for (let i = 0; i < length; i++) buf[i] = (rng() * 2 - 1) * amplitude
  return buf
}

class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.state = 'IDLE'
    this.resultSent = false
    this.isMeasuringFloor = false
    this.floorCountdown = 0
    this.floorPeak = 0

    // Loop probe state
    this.loopLevels = []
    this.loopSeeds = []
    this.loopNoiseBuffers = []
    this.loopSilenceFrames = 0
    this.loopCycleGapFrames = 0
    this.loopIndex = 0
    this.loopPhase = ''
    this.loopPhaseCountdown = 0
    this.loopCycleCount = 0
    this.loopRecording = null
    this.loopRecordIndex = 0
    this.envelopeWindowFrames = 0
    this.loopEnvelope = null
    this.loopEnvIdx = 0
    this.loopEnvCount = 0

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'MEASURE_FLOOR') {
        this.floorCountdown = data.durationFrames ?? 8820
        this.floorPeak = 0
        this.isMeasuringFloor = true
      } else if (data.type === 'PROBE_LOOP_START') {
        this.loopLevels = data.levels || [0.95, 0.7, 0.5, 0.3, 0.1]
        this.loopSeeds = data.seeds || this.loopLevels.map((_, i) => 9990 + i)
        this.loopSilenceFrames = data.silenceFrames ?? Math.floor(0.1 * sampleRate)
        this.loopCycleGapFrames = data.cycleGapFrames ?? Math.floor(0.15 * sampleRate)
        const noiseFrames = data.noiseFrames ?? Math.floor(0.03 * sampleRate)

        // Pre-generate noise buffers (same each cycle for waveform cross-correlation at STOP)
        this.loopNoiseBuffers = this.loopLevels.map((level, i) =>
          generateNoise(this.loopSeeds[i], noiseFrames, level)
        )

        // Allocate recording buffer (max 30s)
        const maxFrames = Math.floor(30 * sampleRate)
        this.loopRecording = new Float32Array(maxFrames)
        this.loopRecordIndex = 0

        // Cycle state
        this.loopIndex = 0
        this.loopCycleCount = 0

        // Envelope (5ms RMS windows) for amplitude pattern matching
        this.envelopeWindowFrames = Math.floor(0.005 * sampleRate)
        const cycleFrames = this.loopLevels.length * (noiseFrames + this.loopSilenceFrames) + this.loopCycleGapFrames
        const envLen = Math.ceil(cycleFrames / this.envelopeWindowFrames) + 1
        this.loopEnvelope = new Float32Array(envLen)
        this.loopEnvIdx = 0
        this.loopEnvCount = 0

        // Start first phase
        this.state = 'LOOPING'
        this.loopPhase = 'NOISE'
        this.loopPhaseCountdown = noiseFrames
      } else if (data.type === 'STOP') {
        console.log('Calibration worklet: STOP received')
        this.flushLoopResult()
      }
    }
  }

  flushLoopResult() {
    if (this.resultSent || !this.loopRecording) return
    this.resultSent = true
    this.state = 'IDLE'
    const actual = this.loopRecording.subarray(0, this.loopRecordIndex)
    this.port.postMessage(
      { type: 'PROBE_RESULT', recording: actual, totalFrames: this.loopRecordIndex },
      [actual.buffer],
    )
  }

  advanceLoopPhase() {
    if (this.loopPhase === 'NOISE') {
      this.loopPhase = 'SILENCE'
      this.loopPhaseCountdown = this.loopSilenceFrames
    } else if (this.loopPhase === 'SILENCE') {
      if (this.loopIndex < this.loopLevels.length - 1) {
        this.loopIndex++
        this.loopPhase = 'NOISE'
        this.loopPhaseCountdown = this.loopNoiseBuffers[0].length
      } else {
        this.loopPhase = 'CYCLE_GAP'
        this.loopPhaseCountdown = this.loopCycleGapFrames
      }
    } else if (this.loopPhase === 'CYCLE_GAP') {
      // Finalize last envelope window (may be partial)
      if (this.loopEnvCount > 0 && this.loopEnvelope && this.loopEnvIdx < this.loopEnvelope.length) {
        this.loopEnvelope[this.loopEnvIdx] = Math.sqrt(this.loopEnvelope[this.loopEnvIdx] / this.loopEnvCount)
      }
      this.loopCycleCount++
      this.sendLoopCycle()
      this.loopIndex = 0
      // Reset envelope for next cycle
      const envLen = this.loopEnvelope.length
      this.loopEnvelope = new Float32Array(envLen)
      this.loopEnvIdx = 0
      this.loopEnvCount = 0
      this.loopPhase = 'NOISE'
      this.loopPhaseCountdown = this.loopNoiseBuffers[0].length
    }
  }

  sendLoopCycle() {
    const sr = sampleRate
    const noiseFrames = this.loopNoiseBuffers[0].length
    const envLen = this.loopEnvIdx + (this.loopEnvCount > 0 ? 1 : 0)
    const envelope = this.loopEnvelope.slice(0, envLen)
    this.port.postMessage({
      type: 'PROBE_CYCLE',
      cycleIndex: this.loopCycleCount,
      levels: this.loopLevels,
      envelope,
      windowFrames: this.envelopeWindowFrames,
      noiseFrames,
      silenceFrames: this.loopSilenceFrames,
      cycleGapFrames: this.loopCycleGapFrames,
      sampleRate: sr,
    }, [envelope.buffer])
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const inData = input && input[0]
    const outData = output && output[0]

    // Floor measurement — runs in any state
    if (this.isMeasuringFloor) {
      if (inData) {
        for (let i = 0; i < inData.length; i++) {
          this.floorPeak = Math.max(this.floorPeak, Math.abs(inData[i]))
        }
        this.floorCountdown -= inData.length
      }
      if (this.floorCountdown <= 0) {
        this.isMeasuringFloor = false
        this.port.postMessage({ type: 'FLOOR_RESULT', peak: this.floorPeak })
      }
      return true
    }

    // Loop probe — continuous repeating pattern
    if (this.state === 'LOOPING') {
      const inData = input && input[0]
      const outData = output && output[0]
      const bufLen = outData ? outData.length : inData ? inData.length : 128
      const noiseLen = this.loopNoiseBuffers[0].length
      const maxRecord = this.loopRecording.length

      let written = 0
      while (written < bufLen) {
        const avail = Math.min(bufLen - written, this.loopPhaseCountdown)

        if (this.loopPhase === 'NOISE') {
          const buf = this.loopNoiseBuffers[this.loopIndex]
          const pos = noiseLen - this.loopPhaseCountdown
          for (let j = 0; j < avail; j++) {
            if (outData) outData[written + j] = buf[pos + j]
          }
        } else {
          for (let j = 0; j < avail; j++) {
            if (outData) outData[written + j] = 0
          }
        }

        // Record mic + accumulate envelope
        if (inData) {
          for (let j = 0; j < avail; j++) {
            const v = inData[written + j]
            if (this.loopRecordIndex < maxRecord) {
              this.loopRecording[this.loopRecordIndex++] = v
            }
            // Envelope: RMS per 5ms window
            const win = this.envelopeWindowFrames
            if (this.loopEnvelope && this.loopEnvIdx < this.loopEnvelope.length) {
              this.loopEnvelope[this.loopEnvIdx] += v * v
              this.loopEnvCount++
              if (this.loopEnvCount >= win) {
                // Finalize current window
                this.loopEnvelope[this.loopEnvIdx] = Math.sqrt(this.loopEnvelope[this.loopEnvIdx] / win)
                this.loopEnvIdx++
                this.loopEnvCount = 0
                if (this.loopEnvIdx < this.loopEnvelope.length) this.loopEnvelope[this.loopEnvIdx] = 0
              }
            }
          }
        }

        written += avail
        this.loopPhaseCountdown -= avail

        if (this.loopPhaseCountdown <= 0) this.advanceLoopPhase()
        if (this.loopRecordIndex >= maxRecord) { this.flushLoopResult(); break }
        if (this.state === 'IDLE') break
      }
      return true
    }

    return true
  }

}

registerProcessor('calibration-processor', CalibrationProcessor)
