/**
 * LatencyCalibrator - Measures round-trip audio latency via a continuous
 * looping probe of white noise at descending amplitudes. The worklet plays
 * [NOISE] [SILENCE] repeating with 5 levels (0.95 → 0.1), accumulating
 * per-segment RMS/peak live. The main thread receives PROBE_CYCLE stats,
 * updates the UI, and auto-stops when levels are stable across 2 cycles.
 *
 * On STOP, the full recording is cross-correlated against each noise
 * pattern to compute per-level response + latency.
 *
 * DEBUG API (console):
 *   __calibrationDebug.run() → DebugResult
 */

// Mulberry32 seeded PRNG — deterministic noise
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = s + 0x6d2b79f5 | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generateNoise(seed: number, length: number, amplitude = 0.3): Float32Array {
  const rng = mulberry32(seed)
  const buf = new Float32Array(length)
  for (let i = 0; i < length; i++) buf[i] = (rng() * 2 - 1) * amplitude
  return buf
}

export interface LatencyCalibrationOptions {
  continuousProbe?: boolean
}

export interface LatencyCalibrationResult {
  success: boolean
  averageLatencyMs: number
  error?: string
  latencies: number[]
}

export interface ProbeCycleData {
  cycleIndex: number
  levels: number[]
  envelope: Float32Array
  windowFrames: number
  noiseFrames: number
  silenceFrames: number
  cycleGapFrames: number
  sampleRate: number
}

export interface LatencyCalibrationCallbacks {
  onProgress?: (progress: number) => void
  onComplete?: (result: LatencyCalibrationResult) => void
  onError?: (error: string) => void
  onStatus?: (status: string) => void
  onProbeReading?: (data: ProbeCycleData, history: ProbeCycleData[]) => void
}

export function matchEnvelope(
  envelope: Float32Array,
  levels: number[],
  noiseFrames: number,
  silenceFrames: number,
  cycleGapFrames: number,
  windowFrames: number,
  onsetWindow: number = 0,
  onsetThreshold: number = 0,
): {
  delayWindows: number
  perLevelRms: number[]
  perLevelReverbFloor: number[]
  matchQuality: number
} {
  const stepLenFrames = noiseFrames + silenceFrames
  const cycleLenFrames = levels.length * stepLenFrames + cycleGapFrames
  const totWindows = Math.ceil(cycleLenFrames / windowFrames)

  // Build expected envelope
  const expected = new Float32Array(totWindows)
  for (let l = 0; l < levels.length; l++) {
    const noiseStartFrames = l * stepLenFrames
    const noiseStartWin = Math.round(noiseStartFrames / windowFrames)
    const noiseWinLen = Math.round(noiseFrames / windowFrames)
    for (let w = 0; w < noiseWinLen && noiseStartWin + w < totWindows; w++) {
      expected[noiseStartWin + w] = levels[l]
    }
  }

  // Auto-detect onset if not provided
  if (onsetWindow === 0 && onsetThreshold > 0) {
    for (let w = 0; w < Math.min(envelope.length, 200); w++) {
      if (envelope[w] > onsetThreshold) { onsetWindow = w; break }
    }
  }

  // Mean of expected pattern (fixed for known levels [0.95,0.7,0.5,0.3,0.1])
  const eMean = expected.reduce((s, v) => s + v, 0) / totWindows

  // Slide expected against received envelope using Pearson correlation
  const searchMargin = Math.floor(totWindows * 0.5)
  const searchStart = Math.max(0, onsetWindow - searchMargin)
  const searchEnd = Math.min(envelope.length - totWindows, searchStart + searchMargin * 4)
  let bestScore = -Infinity
  let bestShift = searchStart
  for (let shift = searchStart; shift < searchEnd; shift++) {
    let rMean = 0
    for (let w = 0; w < totWindows; w++) rMean += envelope[shift + w] || 0
    rMean /= totWindows

    let dot = 0, eVar = 0, rVar = 0
    for (let w = 0; w < totWindows; w++) {
      const eVal = expected[w] - eMean
      const rVal = (envelope[shift + w] || 0) - rMean
      dot += eVal * rVal
      eVar += eVal * eVal
      rVar += rVal * rVal
    }
    const score = dot / Math.sqrt(Math.max(eVar * rVar, 1e-10))
    if (score > bestScore) {
      bestScore = score
      bestShift = shift
    }
  }

  // Extract per-level RMS at best position
  const perLevelRms: number[] = []
  const perLevelReverbFloor: number[] = []
  for (let l = 0; l < levels.length; l++) {
    const noiseStartFrames = l * stepLenFrames
    const noiseStartWin = bestShift + Math.round(noiseStartFrames / windowFrames)
    const noiseWinLen = Math.round(noiseFrames / windowFrames)
    let sum = 0
    let count = 0
    for (let w = 0; w < noiseWinLen && noiseStartWin + w < envelope.length; w++) {
      sum += envelope[noiseStartWin + w]
      count++
    }
    perLevelRms.push(count > 0 ? sum / count : 0)

    // Reverb floor: sample the envelope valley right before this plateau
    // (only meaningful when there's a gap — no gap means no valley)
    if (silenceFrames > 0) {
      const silenceStartWin = noiseStartWin - Math.round(silenceFrames / windowFrames * 0.5)
      const silenceWinLen = Math.round(Math.min(noiseFrames * 0.3, silenceFrames * 0.5) / windowFrames)
      if (silenceStartWin > bestShift && silenceWinLen > 0 && silenceStartWin + silenceWinLen < envelope.length) {
        let sSum = 0
        for (let w = 0; w < silenceWinLen; w++) {
          sSum += envelope[silenceStartWin + w]
        }
        perLevelReverbFloor.push(sSum / silenceWinLen)
      } else {
        perLevelReverbFloor.push(0)
      }
    } else {
      perLevelReverbFloor.push(0)
    }
  }

  return { delayWindows: bestShift, perLevelRms, perLevelReverbFloor, matchQuality: bestScore }
}

export type SignalQuality = 'good' | 'weak' | 'clipping' | 'none'

export interface DebugResult {
  success: boolean
  floorPeak: number
  maxSample: number
  sr: number
  error?: string
  latencies: number[]
  averageLatencyMs: number
  optimalAmplitude: number
  signalQuality: SignalQuality
}

interface LoopProbeParams {
  levels: number[]
  seeds: number[]
  noiseFrames: number
  silenceFrames: number
  cycleGapFrames: number
  maxCycles: number
}

interface LoopSegmentResult {
  level: number
  cycle: number
  delay: number
  correlation: number
  rms: number
  peak: number
  detectable: boolean
}

interface LoopAnalysisResult {
  segments: LoopSegmentResult[]
  overallDetected: boolean
  optimalAmplitude: number
  latencyMs: number
  latencyValuesMs: number[]
  quality: SignalQuality
}

function crossCorrelate(
  recording: Float32Array,
  pattern: Float32Array,
  searchStart: number,
  searchEnd: number,
): { delay: number; correlation: number } {
  let bestDelay = 0
  let bestCorr = -Infinity
  for (let shift = searchStart; shift + pattern.length <= searchEnd; shift++) {
    let dot = 0
    let energy = 1e-10
    for (let i = 0; i < pattern.length; i++) {
      const s = recording[shift + i]
      dot += s * pattern[i]
      energy += s * s
    }
    const corr = dot / Math.sqrt(energy)
    if (corr > bestCorr) {
      bestCorr = corr
      bestDelay = shift - searchStart
    }
  }
  return { delay: bestDelay, correlation: bestCorr }
}

export class LatencyCalibrator {
  floorPeak: number = 0
  private callbacks: Required<LatencyCalibrationCallbacks>
  private options: Required<LatencyCalibrationOptions>

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private isCancelled = false
  private probeCycles: ProbeCycleData[] = []
  private rejectProbePromise: ((reason: string) => void) | null = null

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {},
  ) {
    this.callbacks = {
      onProgress: callbacks.onProgress || (() => {}),
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
      onStatus: callbacks.onStatus || (() => {}),
      onProbeReading: callbacks.onProbeReading || (() => {}),
    }
    this.options = { continuousProbe: false, ...options }
  }

  async calibrate(): Promise<void> {
    this.isCancelled = false
    try {
      const result = await this.runCalibration()
      this.cleanup()
      this.callbacks.onComplete(result)
    } catch (err) {
      this.cleanup()
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onError(`Calibration failed: ${msg}`)
    }
  }

  async debugRun(): Promise<DebugResult> {
    this.isCancelled = false
    try {
      const result = await this.runCalibration()
      this.cleanup()
      return result
    } catch (err) {
      this.cleanup()
      const msg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        floorPeak: 0,
        maxSample: 0,
        sr: 0,
        error: msg,
        latencies: [],
        averageLatencyMs: 0,
        optimalAmplitude: 0.3,
        signalQuality: 'none',
      }
    }
  }

  cancel(): void {
    this.isCancelled = true
    if (this.rejectProbePromise) {
      this.rejectProbePromise('Calibration cancelled by user')
      this.rejectProbePromise = null
    }
    this.cleanup()
  }

  private buildLoopParams(sr: number): LoopProbeParams {
    return {
      levels: [0.95, 0.7, 0.5, 0.3, 0.1],
      seeds: [9990, 9991, 9992, 9993, 9994],
      noiseFrames: Math.floor(0.05 * sr),
      silenceFrames: Math.floor(0.005 * sr),
      cycleGapFrames: Math.floor(0.03 * sr),
      maxCycles: 100,
    }
  }

  private analyzeLoopRecording(
    recording: Float32Array,
    totalFrames: number,
    sr: number,
    floorPeak: number,
    params: LoopProbeParams,
  ): LoopAnalysisResult {
    const { levels, seeds, noiseFrames, silenceFrames, cycleGapFrames } = params
    const stepLen = noiseFrames + silenceFrames
    const cycleLen = levels.length * stepLen + cycleGapFrames
    const corrThreshold = 0.04
    const windowFrames = Math.floor(0.005 * sr) // 5ms envelope windows

    // Compute envelope of the full recording
    const envLen = Math.ceil(totalFrames / windowFrames)
    const envelope = new Float32Array(envLen)
    for (let w = 0; w < envLen; w++) {
      const start = w * windowFrames
      const end = Math.min(start + windowFrames, totalFrames)
      let sumSq = 0
      let count = 0
      for (let i = start; i < end; i++) {
        sumSq += recording[i] * recording[i]; count++
      }
      envelope[w] = count > 0 ? Math.sqrt(sumSq / count) : 0
    }

    // Find signal onset: first envelope window above floor threshold
    const onsetThreshold = Math.max(floorPeak * 3, 0.003)
    let onsetWindow = 0
    for (let w = 0; w < Math.min(envelope.length, 200); w++) {
      if (envelope[w] > onsetThreshold) { onsetWindow = w; break }
    }

    // Use envelope matching to find coarse delay — search constrained around onset
    const envMatch = matchEnvelope(
      envelope, levels, noiseFrames, silenceFrames, cycleGapFrames, windowFrames,
      onsetWindow, onsetThreshold,
    )
    const arrivalFrame = envMatch.delayWindows * windowFrames
    const foundLoud = envMatch.matchQuality > corrThreshold
    if (!foundLoud) {
      return { segments: [], overallDetected: false, optimalAmplitude: 1.0, latencyMs: 0, latencyValuesMs: [], quality: 'none' }
    }

    // ── Confidence check: sample-level attack time vs envelope latency ──
    const attackFrame = (() => {
      const limit = Math.min(totalFrames, Math.floor(0.3 * sr))
      const threshold = Math.max(floorPeak * 5, 0.005)
      for (let i = 0; i < limit; i++) {
        if (Math.abs(recording[i]) > threshold) return i
      }
      return -1
    })()
    const lastLevelEnd = arrivalFrame + levels.length * stepLen + noiseFrames
    const decayFrame = (() => {
      const searchStart = Math.min(lastLevelEnd, totalFrames)
      const searchEnd = Math.min(totalFrames, lastLevelEnd + Math.floor(0.5 * sr))
      const threshold = Math.max(floorPeak * 5, 0.005)
      for (let i = searchStart; i < searchEnd; i++) {
        if (Math.abs(recording[i]) < threshold) return i
      }
      return -1
    })()
    const attackMs = attackFrame >= 0 ? (attackFrame / sr * 1000) : -1
    const envLatMs = arrivalFrame / sr * 1000
    const decayMs = decayFrame >= 0 ? ((decayFrame - lastLevelEnd) / sr * 1000) : -1
    const diffMs = attackMs >= 0 ? Math.abs(attackMs - envLatMs) : -1
    const ok = diffMs >= 0 && diffMs < 15
    console.log(
      `[CONFIDENCE] onsetWindow=${onsetWindow} attackFrame=${attackFrame} ` +
      `attack=${attackMs.toFixed(1)}ms envelope=${envLatMs.toFixed(1)}ms ` +
      `diff=${diffMs.toFixed(1)}ms ${ok ? '✓' : '⚠ mismatch'}`
    )
    if (decayMs >= 0) {
      console.log(`[CONFIDENCE] decay=${decayMs.toFixed(1)}ms (reverb tail)`)
    }
    console.log(`[CONFIDENCE] per-level RMS: [${envMatch.perLevelRms.map(v => v.toFixed(4)).join(', ')}] Q=${envMatch.matchQuality.toFixed(3)}`)

    // Generate each noise pattern for correlation
    const noisePatterns = levels.map((_, i) => generateNoise(seeds[i], noiseFrames, 1.0))

    // For each cycle, correlate each level
    const segments: LoopSegmentResult[] = []
    let maxCycles = Math.floor((totalFrames - arrivalFrame) / cycleLen)
    if (maxCycles > 10) maxCycles = 10

    for (let c = 0; c < maxCycles; c++) {
      // Compute per-cycle envelope to get reverb floor for this cycle
      const cycleStartFr = arrivalFrame + c * cycleLen
      // Use per-level reverb floor from the main envelope match as a proxy
      // (it was computed from the envelope at the best shift position,
      //  which encompasses all cycles averaged; good enough)

      for (let l = 0; l < levels.length; l++) {
        const expectedStart = cycleStartFr + l * stepLen
        const margin = Math.floor(0.001 * sr)
        const xStart = Math.max(0, expectedStart - margin)
        const xEnd = Math.min(totalFrames - noiseFrames, expectedStart + noiseFrames + margin)

        let corr = 0
        let delay = 0
        if (xStart < xEnd) {
          const xc = crossCorrelate(recording, noisePatterns[l], xStart, xEnd)
          corr = xc.correlation
          delay = xc.delay
        }

        // RMS + peak in noise-length window at the detected position
        const detPos = expectedStart + delay
        let sumSq = 0
        let peak = 0
        const winLen = Math.min(noiseFrames, Math.max(0, totalFrames - detPos))
        for (let i = 0; i < winLen; i++) {
          const v = recording[detPos + i]
          sumSq += v * v
          if (Math.abs(v) > peak) peak = Math.abs(v)
        }
        const rms = winLen > 0 ? Math.sqrt(sumSq / winLen) : 0

        // Detectability: use per-level reverb floor (not silence floorPeak)
        // Reverb floor accounts for room ringing from previous louder tones
        const reverbFloor = envMatch.perLevelReverbFloor[l] || floorPeak
        const localThreshold = Math.max(reverbFloor * 2, floorPeak * 3)
        const detectable = corr > corrThreshold && peak > localThreshold
        segments.push({ level: levels[l], cycle: c, delay, correlation: corr, rms, peak, detectable })
      }
    }

    // Log results
    console.group('Calibration: Loop Probe Analysis')
    console.log(`Envelope match: quality=${envMatch.matchQuality.toFixed(3)} delayFrames=${arrivalFrame} (${(arrivalFrame / sr * 1000).toFixed(0)}ms), ${maxCycles} cycles`)
    for (const s of segments) {
      console.log(
        `  cycle=${s.cycle} level=${s.level.toFixed(2)} ` +
        `delay=${s.delay} corr=${s.correlation.toFixed(3)} ` +
        `rms=${s.rms.toFixed(4)} peak=${s.peak.toFixed(4)} ` +
        `${s.detectable ? 'YES' : 'NO'}`
      )
    }
    if (maxCycles > 0) {
      console.log(`  Per-level reverb floors: [${envMatch.perLevelReverbFloor.map(v => v.toFixed(4)).join(', ')}]`)
    }
    console.groupEnd()

    // Compute optimal amplitude from detectable segments
    const detectable = segments.filter(s => s.detectable)
    if (detectable.length === 0) {
      return { segments, overallDetected: false, optimalAmplitude: 1.0, latencyMs: 0, latencyValuesMs: [], quality: 'none' }
    }

    const targetRms = 0.173
    let bestSegment = detectable[0]
    for (const s of detectable) {
      if (Math.abs(s.rms - targetRms) < Math.abs(bestSegment.rms - targetRms)) bestSegment = s
    }
    const optimalAmplitude = Math.max(0.05, Math.min(1.0,
      bestSegment.level * (targetRms / Math.max(bestSegment.rms, 1e-10))
    ))

    // Round-trip latency: arrivalFrame (envelope delay) + fine-tuning offset
    // The cross-correlation search window is [expectedStart - margin, ...]
    // so s.delay includes a +margin offset that we subtract
    const margin = Math.floor(0.001 * sr)
    const latencies: number[] = []
    for (const s of detectable) {
      const totalFrames = arrivalFrame + Math.max(-margin, s.delay - margin)
      latencies.push(Math.round((totalFrames / sr) * 1000))
    }
    const avgLatMs = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : Math.round((arrivalFrame / sr) * 1000)

    const anyClipping = detectable.some(s => s.peak > 0.99)
    let quality: SignalQuality = 'good'
    if (anyClipping) quality = 'clipping'
    else if (optimalAmplitude > 0.8) quality = 'weak'

    console.log(`Loop analysis: optimal=${optimalAmplitude.toFixed(3)} latency=${avgLatMs}ms quality=${quality} latencies=[${latencies.join(',')}]`)
    return { segments, overallDetected: true, optimalAmplitude, latencyMs: avgLatMs, latencyValuesMs: latencies, quality }
  }

  private checkLevelStable(cycles: ProbeCycleData[]): boolean {
    if (cycles.length < 3) return false
    const last = cycles[cycles.length - 1]
    const prev = cycles[cycles.length - 2]
    const lastMatch = matchEnvelope(
      last.envelope, last.levels, last.noiseFrames,
      last.silenceFrames, last.cycleGapFrames, last.windowFrames,
    )
    const prevMatch = matchEnvelope(
      prev.envelope, prev.levels, prev.noiseFrames,
      prev.silenceFrames, prev.cycleGapFrames, prev.windowFrames,
    )
    let maxChange = 0
    for (let i = 0; i < lastMatch.perLevelRms.length; i++) {
      const a = lastMatch.perLevelRms[i]
      const b = prevMatch.perLevelRms[i]
      if (a < 0.001 && b < 0.001) continue
      const change = Math.abs(a - b) / Math.max(a, b, 0.001)
      if (change > maxChange) maxChange = change
    }
    return maxChange < 0.2
  }

  private async runCalibration(): Promise<LatencyCalibrationResult & DebugResult> {
    this.ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (this.ctx.state === 'suspended') { await this.ctx.resume() }
    const sr = this.ctx.sampleRate

    // Get mic stream
    const supported = navigator.mediaDevices.getSupportedConstraints()
    const ac: Record<string, any> = { channelCount: 1, sampleRate: this.ctx!.sampleRate }
    if (supported.echoCancellation) ac.echoCancellation = false
    if (supported.noiseSuppression) ac.noiseSuppression = false
    if (supported.autoGainControl) ac.autoGainControl = false
    ac.advanced = [{ echoCancellation: false, autoGainControl: false, noiseSuppression: false }]
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: ac })

    const track = this.stream.getAudioTracks()[0]
    const settings = track?.getSettings()
    const capabilities = track?.getCapabilities()
    console.log('Calibrator mic settings:', settings)
    console.log('Calibrator mic capabilities:', capabilities)

    // Re-apply constraints on the live track — sometimes respected better after capture
    if (track) {
      try {
        await track.applyConstraints({
          advanced: [{ echoCancellation: false, autoGainControl: false, noiseSuppression: false }],
        })
        const finalSettings = track.getSettings()
        console.log('Calibrator mic final settings (after applyConstraints):', finalSettings)
      } catch {
        console.warn('Calibrator: applyConstraints failed — constraints may not be supported')
      }
    }

    try {
      await this.ctx.audioWorklet.addModule(`/worklets/calibration.worklet.js?ck=${Date.now()}`)
    } catch (err: any) {
      if (!err?.message?.includes('already been added')) throw err
    }

    this.workletNode = new AudioWorkletNode(this.ctx, 'calibration-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
    })
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.workletNode)
    this.workletNode.connect(this.ctx.destination)

    // ── Phase 1: Noise floor ──
    this.callbacks.onStatus?.('Measuring noise floor...')
    this.callbacks.onProgress?.(5)

    const measureFloor = (): Promise<number> => new Promise<number>((resolve) => {
      this.workletNode!.port.onmessage = (e) => {
        if (e.data.type === 'FLOOR_RESULT') { resolve(e.data.peak) }
      }
      this.workletNode!.port.postMessage({ type: 'MEASURE_FLOOR', durationFrames: Math.floor(0.2 * sr) })
    })
    let floorPeak = await measureFloor()
    // If floor is suspiciously high (speaker ringing from previous run), wait and re-measure
    if (floorPeak > 0.5) {
      console.log(`Calibration: floor suspiciously high (${floorPeak.toFixed(4)}), retrying after 500ms silence...`)
      await new Promise((r) => setTimeout(r, 500))
      floorPeak = await measureFloor()
    }
    if (floorPeak < 0.001) {
      console.log('Calibration: floor measurement returned near-zero, retrying...')
      await new Promise((r) => setTimeout(r, 200))
      floorPeak = await measureFloor()
    }
    if (floorPeak < 0.001) floorPeak = 0.005
    this.floorPeak = floorPeak
    console.log(`Calibration: noise floor peak=${floorPeak.toFixed(4)}`)

    this.callbacks.onProgress?.(10)

    // ── Phase 2: Continuous loop probe (detects level + latency in one pass) ──
    this.callbacks.onStatus?.('Probing levels and measuring latency...')
    const loopParams = this.buildLoopParams(sr)
    this.probeCycles = []

    let optimalAmplitude = 1.0
    let signalQuality: SignalQuality = 'none'
    let avgLatencyMs = 0
    let maxSample = 0
    let maxCorrelation = 0
    let latencies: number[] = []

    // Retry loop: up to 3 attempts with reduced levels on clipping
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.isCancelled) break
      const params = { ...loopParams }
      if (attempt > 0) {
        // Reduce max level by half
        const maxLvl = Math.max(...params.levels)
        params.levels = params.levels.map(l => l * 0.5)
        console.log(`[CAL] retry ${attempt}: levels reduced to [${params.levels.map(l => l.toFixed(3)).join(',')}]`)
        this.callbacks.onStatus?.(`Attempt ${attempt + 1}: reducing amplitude (was clipping)...`)
      }

      // Start loop probe
      this.workletNode.port.postMessage({ type: 'PROBE_LOOP_START', ...params })

      const probeResultPromise = new Promise<{ recording: Float32Array; totalFrames: number }>((resolve, reject) => {
        this.rejectProbePromise = reject
        const timeout = setTimeout(() => reject(new Error('Probe timed out after 35s')), 35000)
        let autoStopSent = false
        let lastStableCycles = 0

        this.workletNode!.port.onmessage = (e) => {
          if (e.data.type === 'PROBE_CYCLE') {
            const data = e.data as ProbeCycleData
            this.probeCycles.push(data)
            this.callbacks.onProbeReading(data, this.probeCycles)

          // Diagnostic logging
          const matchResult = matchEnvelope(
            data.envelope, data.levels, data.noiseFrames,
            data.silenceFrames, data.cycleGapFrames, data.windowFrames,
          )
          const delayMs = Math.round((matchResult.delayWindows * data.windowFrames / data.sampleRate) * 1000)
          const dbg = matchResult.perLevelRms.map((r, i) => {
            const reverbFloor = matchResult.perLevelReverbFloor[i] || 0.001
            const snrDb = 20 * Math.log10(r / reverbFloor)
            return `L${data.levels[i].toFixed(2)}→rms=${r.toFixed(4)}(${snrDb.toFixed(0)}dBvsReverb)`
          }).join(' ')
          const detectable = matchResult.perLevelRms.filter((r, i) => {
            const rf = matchResult.perLevelReverbFloor[i] || this.floorPeak
            return r > Math.max(rf * 2, this.floorPeak * 3)
          }).length
          console.log(
            `[CAL] cycle=${data.cycleIndex} silenceFloor=${this.floorPeak.toFixed(4)} ` +
            `reverbFloors=[${matchResult.perLevelReverbFloor.map(v => v.toFixed(4)).join(',')}] ` +
            `Q=${matchResult.matchQuality.toFixed(3)} delay=${delayMs}ms ` +
            `${dbg} | ${detectable}/${data.levels.length} detectable`
          )

            // Auto-stop check
            if (!this.options.continuousProbe && !autoStopSent && this.probeCycles.length >= 3) {
              const stable = this.checkLevelStable(this.probeCycles)
              if (stable) {
                lastStableCycles++
                if (lastStableCycles >= 2) {
                  autoStopSent = true
                  clearTimeout(timeout)
                  this.callbacks.onStatus?.('Levels stable — stopping probe.')
                  this.workletNode!.port.postMessage({ type: 'STOP' })
                }
              } else {
                lastStableCycles = 0
              }
            }
          } else if (e.data.type === 'PROBE_RESULT') {
            clearTimeout(timeout)
            this.rejectProbePromise = null
            resolve({ recording: e.data.recording, totalFrames: e.data.totalFrames })
          }
        }
      })

      let probeResult: { recording: Float32Array; totalFrames: number }
      try {
        probeResult = await probeResultPromise
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Probe error'
        console.warn(`Calibration: ${msg}`)
        this.callbacks.onStatus?.('Probe error — using max amplitude.')
        probeResult = { recording: new Float32Array(0), totalFrames: 0 }
      }

      if (probeResult.totalFrames > 0) {
        const analysis = this.analyzeLoopRecording(
          probeResult.recording, probeResult.totalFrames, sr, floorPeak, params,
        )
        optimalAmplitude = analysis.optimalAmplitude
        signalQuality = analysis.quality
        avgLatencyMs = analysis.latencyMs

        if (analysis.overallDetected) {
          latencies = analysis.latencyValuesMs
          maxCorrelation = Math.max(...analysis.segments.map(s => s.correlation))
          maxSample = Math.max(...analysis.segments.map(s => s.peak))
        }

        if (!analysis.overallDetected) {
          console.warn('Calibration: no detectable segments — using max amplitude')
          this.callbacks.onStatus?.('Signal not detected at any level.')
          break
        } else if (analysis.quality === 'clipping' && attempt < 2) {
          console.log(`[CAL] clipping detected, retrying with reduced levels (attempt ${attempt + 1})`)
          this.callbacks.onStatus?.(`Signal clipping — reducing amplitude (attempt ${attempt + 1}/3)...`)
          continue
        } else {
          // Good or weak result, or out of retries
          if (analysis.quality === 'clipping') {
            this.callbacks.onStatus?.('Still clipping after reduction — using current levels.')
          } else if (analysis.quality === 'weak') {
            this.callbacks.onStatus?.('Signal weak — using maximum amplitude.')
          } else {
            this.callbacks.onStatus?.(`Levels good. Latency: ${avgLatencyMs}ms, amplitude: ${optimalAmplitude.toFixed(2)}.`)
          }
          break
        }
      } else {
        this.callbacks.onStatus?.('Probe recording empty.')
        break
      }
    }

    this.callbacks.onProgress?.(50)

    if (latencies.length === 0) {
      const error = `No valid latency measurements (max correlation ${maxCorrelation.toFixed(2)}). Ensure speakers are audible to the microphone.`
      return {
        success: false, averageLatencyMs: 0,
        floorPeak, maxSample, sr, latencies: [], error,
        optimalAmplitude, signalQuality,
      }
    }

    const averageLatencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)

    // ── Phase 5: Enhanced diagnostics ──
    const issues: string[] = []
    const warnings: string[] = []

    if (signalQuality === 'none') {
      issues.push('Could not detect test tone. Verify speakers are on, volume is up, and microphone is enabled.')
    } else if (signalQuality === 'clipping') {
      warnings.push('Signal level too high — results may be less reliable. Reduce speaker volume or move speaker further from mic.')
    } else if (signalQuality === 'weak') {
      warnings.push('Signal level is low. For best results, turn up speaker volume or bring speaker closer to the microphone.')
    }

    const ratio = floorPeak > 0 ? maxSample / floorPeak : 0
    if (ratio < 2) issues.push(`Signal too quiet (${ratio.toFixed(1)}x noise floor). Turn up speaker volume.`)
    if (maxSample > 0.99) warnings.push(`Signal near clipping (peak ${maxSample.toFixed(2)}). Lower speaker volume.`)

    // Check per-burst reliability
    const reliableCount = latencies.filter((l) => {
      const dev = Math.abs(l - averageLatencyMs)
      return dev < 50
    }).length
    if (reliableCount < latencies.length) {
      warnings.push(`${latencies.length - reliableCount}/${latencies.length} measurements had high variance.`)
    }

    this.callbacks.onProgress?.(95)

    const success = issues.length === 0
    const error = issues.length > 0 ? issues.join(' ') : undefined

    console.log('Calibration result:', {
      averageLatencyMs,
      testsUsed: latencies.length,
      latencies,
      floorPeak: floorPeak.toFixed(4),
      maxSample: maxSample.toFixed(4),
      maxRatio: ratio.toFixed(1),
      maxCorrelation: maxCorrelation.toFixed(3),
      optimalAmplitude: optimalAmplitude.toFixed(3),
      signalQuality,
      success,
    })
    if (warnings.length > 0) console.warn(warnings.join(' '))
    if (error) console.error(error)

    this.callbacks.onProgress?.(100)
    if (success) {
      this.callbacks.onStatus?.(`Done. Latency: ${averageLatencyMs}ms, level: ${signalQuality}.`)
    }

    const debugResult: DebugResult = {
      success, sr, error,
      floorPeak, maxSample,
      latencies, averageLatencyMs,
      optimalAmplitude, signalQuality,
    }

    const calResult: LatencyCalibrationResult = {
      success, averageLatencyMs, latencies, error,
    }

    return { ...debugResult, ...calResult }
  }

  private cleanup(): void {
    if (this.workletNode) {
      try { this.workletNode.port.onmessage = null; this.workletNode.port.close(); this.workletNode.disconnect() }
      catch { /* ignore */ }
      this.workletNode = null
    }
    if (this.source) { try { this.source.disconnect() } catch { /* ignore */ } this.source = null }
    if (this.ctx && this.ctx.state !== 'closed') { try { this.ctx.close() } catch { /* ignore */ } }
    this.ctx = null
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null }
  }
}

export async function testEnvelopeCycle(): Promise<{
  envelope: Float32Array
  matchResult: ReturnType<typeof matchEnvelope>
  params: { levels: number[]; noiseFrames: number; silenceFrames: number; cycleGapFrames: number; windowFrames: number; sr: number }
} | { error: string }> {
  // Quick one-cycle probe for diagnostic purposes
  const ctx = new (window.AudioContext || (window as unknown as any).webkitAudioContext)()
  if (ctx.state === 'suspended') await ctx.resume()
  const sr = ctx.sampleRate

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  try {
    await ctx.audioWorklet.addModule(`/worklets/calibration.worklet.js?ck=${Date.now()}`)
  } catch { /* already added */ }

  const node = new AudioWorkletNode(ctx, 'calibration-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
  const source = ctx.createMediaStreamSource(stream)
  source.connect(node)
  node.connect(ctx.destination)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ error: 'testEnvelopeCycle timed out after 10s' })
    }, 10000)

    const cleanup = () => {
      clearTimeout(timeout)
      try { node.port.close(); node.disconnect() } catch {}
      try { source.disconnect() } catch {}
      if (ctx.state !== 'closed') ctx.close()
      stream.getTracks().forEach(t => t.stop())
    }

    node.port.onmessage = (e) => {
      if (e.data.type === 'PROBE_CYCLE') {
        const data = e.data
        const matchResult = matchEnvelope(
          data.envelope, data.levels, data.noiseFrames,
          data.silenceFrames, data.cycleGapFrames, data.windowFrames,
        )
        cleanup()
        resolve({
          envelope: data.envelope,
          matchResult,
          params: {
            levels: data.levels, noiseFrames: data.noiseFrames,
            silenceFrames: data.silenceFrames, cycleGapFrames: data.cycleGapFrames,
            windowFrames: data.windowFrames, sr: data.sampleRate,
          },
        })
      }
    }

    const levels = [0.95, 0.7, 0.5, 0.3, 0.1]
    const seeds = [9990, 9991, 9992, 9993, 9994]
    const noiseFrames = Math.floor(0.05 * sr)
    node.port.postMessage({
      type: 'PROBE_LOOP_START',
      levels, seeds,
      noiseFrames,
      silenceFrames: Math.floor(0.005 * sr),
      cycleGapFrames: Math.floor(0.03 * sr),
    })
  })
}

if (typeof window !== 'undefined') {
  ;(window as any).__calibrationDebug = {
    run: async () => {
      const c = new LatencyCalibrator()
      return c.debugRun()
    },
    testEnvelope: testEnvelopeCycle,
  }
  console.log('LatencyCalibrator: Debug API at window.__calibrationDebug.run() and .testEnvelope()')
}
