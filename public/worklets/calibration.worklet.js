/**
 * Calibration worklet for round-trip latency measurement using
 * white noise + cross-correlation (Firefox-safe, AGC-resistant).
 *
 * Single START triggers: [wake burst] [wake gap] [burst 1..N] [margin]
 * Single RESULT returns the full mic recording buffer + burst schedule
 * for cross-correlation on the main thread.
 *
 * PROBE: plays a pre-built Float32Array sequence, records mic,
 * returns PROBE_RESULT with the recorded buffer.
 *
 * Messages:
 *   START { seed, numBursts, burstLength, interBurstGap,
 *           wakeBurstLength, wakeGap, recordMargin, amplitude }
 *   PROBE { sequence: Float32Array }  — pre-built output to play & record
 *   STOP  — immediate flush of current buffer
 *   MEASURE_FLOOR { durationFrames }
 *   RESULT { recordingBuffer, totalFrames, wakeStartFrame,
 *            burstStartFrames[], burstLength, seed, numBursts, sampleRate }
 *   PROBE_RESULT { recording: Float32Array, totalFrames }
 *   FLOOR_RESULT { peak }
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
    this.seed = 42
    this.amplitude = 0.3
    this.wakeAmplitude = 1.0
    this.numBursts = 5
    this.burstLength = 0
    this.interBurstGap = 0
    this.wakeBurstLength = 0
    this.wakeGap = 0
    this.recordMargin = 0
    this.totalDuration = 0
    this.recordingBuffer = null
    this.bufferIndex = 0
    this.frameCounter = 0
    this.phase = ''
    this.phaseCountdown = 0
    this.currentBurst = 0
    this.wakeStartFrame = -1
    this.burstStartFrames = []
    this.wakeNoise = null
    this.burstNoise = null
    this.resultSent = false
    this._loggedProcess = false
    this.isMeasuringFloor = false
    this.floorCountdown = 0
    this.floorPeak = 0

    // Probe state
    this.probeSequence = null
    this.probeRecording = null
    this.probeIndex = 0

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
      } else if (data.type === 'PROBE') {
        this.probeSequence = data.sequence
        this.probeRecording = new Float32Array(data.sequence.length)
        this.probeIndex = 0
        this.state = 'PROBING'
      } else if (data.type === 'PROBE_LOOP_START') {
        this.loopLevels = data.levels || [0.95, 0.7, 0.5, 0.3, 0.1]
        this.loopSeeds = data.seeds || this.loopLevels.map((_, i) => 9990 + i)
        this.loopSilenceFrames = data.silenceFrames || Math.floor(0.1 * sampleRate)
        this.loopCycleGapFrames = data.cycleGapFrames || Math.floor(0.15 * sampleRate)
        const noiseFrames = data.noiseFrames || Math.floor(0.03 * sampleRate)

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
      } else if (data.type === 'START') {
        this.seed = data.seed || 42
        this.amplitude = data.amplitude ?? 0.3
        this.wakeAmplitude = data.wakeAmplitude ?? 1.0
        this.numBursts = data.numBursts || 5
        this.burstLength = data.burstLength || Math.floor(0.05 * sampleRate)
        this.interBurstGap = data.interBurstGap || Math.floor(0.4 * sampleRate)
        this.wakeBurstLength = data.wakeBurstLength || Math.floor(0.25 * sampleRate)
        this.wakeGap = data.wakeGap || Math.floor(0.5 * sampleRate)
        this.recordMargin = data.recordMargin || Math.floor(0.2 * sampleRate)

        this.totalDuration =
          this.wakeBurstLength +
          this.wakeGap +
          this.numBursts * (this.burstLength + this.interBurstGap) +
          this.recordMargin

        console.log('Calibration worklet: START',
          'totalDuration:', this.totalDuration,
          'amplitude:', this.amplitude,
          'wakeAmplitude:', this.wakeAmplitude,
          'numBursts:', this.numBursts,
          'burstLength:', this.burstLength,
          'wakeBurstLength:', this.wakeBurstLength,
          'wakeGap:', this.wakeGap,
          'interBurstGap:', this.interBurstGap,
          'recordMargin:', this.recordMargin)

        this.recordingBuffer = new Float32Array(this.totalDuration)
        this.bufferIndex = 0
        this.frameCounter = 0
        this.currentBurst = 0
        this.wakeStartFrame = -1
        this.burstStartFrames = []
        this.wakeNoise = generateNoise(this.seed + 1, this.wakeBurstLength, this.wakeAmplitude)
        this.burstNoise = generateNoise(this.seed, this.burstLength, this.amplitude)
        this.resultSent = false

        this.state = 'RECORDING'
        this.phase = 'WAKE_BURST'
        this.phaseCountdown = this.wakeBurstLength
      } else if (data.type === 'STOP') {
        console.log('Calibration worklet: STOP received, state:', this.state)
        if (this.state === 'RECORDING') this.flushResult()
        else if (this.state === 'LOOPING') this.flushLoopResult()
      }
    }
  }

  flushResult() {
    if (this.resultSent) { console.log('Calibration worklet: flushResult skipped (already sent)'); return }
    this.resultSent = true
    this.state = 'IDLE'
    console.log('Calibration worklet: flushResult',
      'bufferIndex:', this.bufferIndex,
      'burstStartFrames:', JSON.stringify(this.burstStartFrames),
      'totalDuration:', this.totalDuration)
    const actual = this.recordingBuffer.subarray(0, this.bufferIndex)
    this.port.postMessage(
      {
        type: 'RESULT',
        recordingBuffer: actual,
        totalFrames: this.bufferIndex,
        wakeStartFrame: this.wakeStartFrame,
        burstStartFrames: this.burstStartFrames,
        burstLength: this.burstLength,
        seed: this.seed,
        numBursts: this.numBursts,
        sampleRate: sampleRate,
      },
      [actual.buffer],
    )
  }

  flushLoopResult() {
    if (this.resultSent) return
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
    const envelope = this.loopEnvelope.subarray(0, envLen)
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

    // Probe — play pre-built sequence, record mic
    if (this.state === 'PROBING') {
      if (!this.probeSequence) { this.state = 'IDLE'; return true }
      const n = Math.min(
        outData ? outData.length : inData ? inData.length : 128,
        this.probeSequence.length - this.probeIndex,
      )
      for (let j = 0; j < n; j++) {
        if (outData) outData[j] = this.probeSequence[this.probeIndex]
        if (inData) this.probeRecording[this.probeIndex] = inData[j]
        this.probeIndex++
      }
      if (this.probeIndex >= this.probeSequence.length) {
        this.state = 'IDLE'
        const rec = this.probeRecording
        this.probeSequence = null
        this.probeRecording = null
        this.port.postMessage(
          { type: 'PROBE_RESULT', recording: rec, totalFrames: rec.length },
          [rec.buffer],
        )
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

    if (this.state !== 'RECORDING') return true

    if (!this._loggedProcess) {
      this._loggedProcess = true
      console.log('Calibration worklet: process() entered RECORDING',
        'hasOutput:', !!output, 'hasInput:', !!input,
        'phase:', this.phase, 'phaseCountdown:', this.phaseCountdown,
        'totalDuration:', this.totalDuration)
    }

    const len = outData ? outData.length : inData ? inData.length : 128

    let written = 0
    while (written < len) {
      const avail = Math.min(len - written, this.phaseCountdown)

      if (this.phase === 'WAKE_BURST') {
        if (this.wakeStartFrame === -1) this.wakeStartFrame = this.frameCounter
        for (let j = 0; j < avail; j++) {
          const pos = this.wakeBurstLength - this.phaseCountdown + j
          if (outData) outData[written + j] = this.wakeNoise[pos]
        }
      } else if (this.phase === 'BURST_PLAY') {
        for (let j = 0; j < avail; j++) {
          const pos = this.burstLength - this.phaseCountdown + j
          if (outData) outData[written + j] = this.burstNoise[pos]
        }
      } else if (outData) {
        for (let j = 0; j < avail; j++) outData[written + j] = 0
      }

      if (inData) {
        for (let j = 0; j < avail; j++) {
          if (this.bufferIndex < this.recordingBuffer.length)
            this.recordingBuffer[this.bufferIndex++] = inData[written + j]
        }
      }

      written += avail
      this.frameCounter += avail
      this.phaseCountdown -= avail

      if (this.phaseCountdown <= 0) this.advancePhase()
      if (this.phase === 'DONE') {
        this.flushResult()
        break
      }
    }

    return true
  }

  advancePhase() {
    const prevPhase = this.phase
    switch (this.phase) {
      case 'WAKE_BURST':
        this.phase = 'WAKE_GAP'
        this.phaseCountdown = this.wakeGap
        break
      case 'WAKE_GAP':
        this.phase = 'BURST_PLAY'
        this.currentBurst = 1
        this.phaseCountdown = this.burstLength
        this.burstStartFrames.push(this.frameCounter)
        console.log('Calibration worklet: burst 1 start at frame:', this.frameCounter)
        break
      case 'BURST_PLAY':
        this.currentBurst++
        if (this.currentBurst > this.numBursts) {
          this.phase = 'MARGIN'
          this.phaseCountdown = this.recordMargin
        } else {
          this.phase = 'BURST_GAP'
          this.phaseCountdown = this.interBurstGap
        }
        break
      case 'BURST_GAP':
        this.phase = 'BURST_PLAY'
        this.phaseCountdown = this.burstLength
        this.burstStartFrames.push(this.frameCounter)
        console.log('Calibration worklet: burst', this.currentBurst, 'start at frame:', this.frameCounter)
        break
      case 'MARGIN':
        this.phase = 'DONE'
        break
    }
    console.log('Calibration worklet: phase', prevPhase, '→', this.phase,
      'countdown:', this.phaseCountdown,
      'frameCounter:', this.frameCounter,
      'bufferIndex:', this.bufferIndex,
      'currentBurst:', this.currentBurst)
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
