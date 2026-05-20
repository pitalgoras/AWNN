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
): { delayWindows: number; perLevelRms: number[]; matchQuality: number } {
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

  // Slide expected against received envelope
  const searchLen = Math.min(envelope.length - totWindows, totWindows * 3)
  let bestScore = -Infinity
  let bestShift = 0
  for (let shift = 0; shift < searchLen; shift++) {
    let dot = 0
    let eLen = 0
    let rLen = 0
    for (let w = 0; w < totWindows; w++) {
      const eVal = expected[w]
      const rVal = envelope[shift + w] || 0
      dot += eVal * rVal
      eLen += eVal * eVal
      rLen += rVal * rVal
    }
    const score = dot / Math.sqrt(Math.max(eLen * rLen, 1e-10))
    if (score > bestScore) {
      bestScore = score
      bestShift = shift
    }
  }

  // Extract per-level RMS at best position
  const perLevelRms: number[] = []
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
  }

  return { delayWindows: bestShift, perLevelRms, matchQuality: bestScore }
}

export type SignalQuality = 'good' | 'weak' | 'clipping' | 'none'

export interface DebugResult {
  success: boolean
  latencyMs: number
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
        latencyMs: 0,
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
      noiseFrames: Math.floor(0.03 * sr),
      silenceFrames: Math.floor(0.02 * sr),
      cycleGapFrames: Math.floor(0.1 * sr),
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

    // Use envelope matching to find coarse delay
    const envMatch = matchEnvelope(envelope, levels, noiseFrames, silenceFrames, cycleGapFrames, windowFrames)
    const arrivalFrame = envMatch.delayWindows * windowFrames
    const foundLoud = envMatch.matchQuality > corrThreshold
    if (!foundLoud) {
      return { segments: [], overallDetected: false, optimalAmplitude: 1.0, latencyMs: 0, quality: 'none' }
    }

    // Generate each noise pattern for correlation
    const noisePatterns = levels.map((_, i) => generateNoise(seeds[i], noiseFrames, 1.0))

    // For each cycle, correlate each level
    const segments: LoopSegmentResult[] = []
    let maxCycles = Math.floor((totalFrames - arrivalFrame) / cycleLen)
    if (maxCycles > 10) maxCycles = 10

    for (let c = 0; c < maxCycles; c++) {
      const cycleStart = arrivalFrame + c * cycleLen
      for (let l = 0; l < levels.length; l++) {
        // Tight search window: ±3ms around the expected position
        const expectedStart = cycleStart + l * stepLen
        const margin = Math.floor(0.003 * sr)
        const xStart = Math.max(0, expectedStart - margin)
        const xEnd = Math.min(totalFrames - noiseFrames, expectedStart + noiseFrames + margin)

        let corr = 0
        let delay = 0
        if (xStart < xEnd) {
          const xc = crossCorrelate(recording, noisePatterns[l], xStart, xEnd)
          corr = xc.correlation
          delay = xc.delay
        }

        // RMS in noise-length window at the detected position
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

        const detectable = corr > corrThreshold && rms > floorPeak * 2
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
    console.groupEnd()

    // Compute optimal amplitude from detectable segments
    const detectable = segments.filter(s => s.detectable)
    if (detectable.length === 0) {
      return { segments, overallDetected: false, optimalAmplitude: 1.0, latencyMs: 0, quality: 'none' }
    }

    const targetRms = 0.173
    let bestSegment = detectable[0]
    for (const s of detectable) {
      if (Math.abs(s.rms - targetRms) < Math.abs(bestSegment.rms - targetRms)) bestSegment = s
    }
    const optimalAmplitude = Math.max(0.05, Math.min(1.0,
      bestSegment.level * (targetRms / Math.max(bestSegment.rms, 1e-10))
    ))

    // Average latency from all detectable segments
    const latencies = detectable.filter(s => s.delay > 0).map(s => Math.round((s.delay / sr) * 1000))
    const avgLatMs = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : Math.round((arrivalFrame / sr) * 1000)

    const anyClipping = detectable.some(s => s.peak > 0.99)
    let quality: SignalQuality = 'good'
    if (anyClipping) quality = 'clipping'
    else if (optimalAmplitude > 0.8) quality = 'weak'

    console.log(`Loop analysis: optimal=${optimalAmplitude.toFixed(3)} latency=${avgLatMs}ms quality=${quality}`)
    return { segments, overallDetected: true, optimalAmplitude, latencyMs: avgLatMs, quality }
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

    const floorPromise = new Promise<number>((resolve) => {
      this.workletNode!.port.onmessage = (e) => {
        if (e.data.type === 'FLOOR_RESULT') { resolve(e.data.peak) }
      }
    })
    this.workletNode.port.postMessage({ type: 'MEASURE_FLOOR', durationFrames: Math.floor(0.2 * sr) })
    let floorPeak = await floorPromise
    if (floorPeak < 0.001) {
      console.log('Calibration: floor measurement returned near-zero, retrying...')
      await new Promise((r) => setTimeout(r, 200))
      const floorPromise2 = new Promise<number>((resolve) => {
        this.workletNode!.port.onmessage = (e) => {
          if (e.data.type === 'FLOOR_RESULT') { this.workletNode!.port.onmessage = null; resolve(e.data.peak) }
        }
      })
      this.workletNode.port.postMessage({ type: 'MEASURE_FLOOR', durationFrames: Math.floor(0.2 * sr) })
      floorPeak = await floorPromise2
    }
    if (floorPeak < 0.001) floorPeak = 0.005
    console.log(`Calibration: noise floor peak=${floorPeak.toFixed(4)}`)

    this.callbacks.onProgress?.(10)

    // ── Phase 2: Continuous loop probe (detects level + latency in one pass) ──
    this.callbacks.onStatus?.('Probing levels and measuring latency...')
    const loopParams = this.buildLoopParams(sr)
    this.probeCycles = []

    // Start loop probe — no wake gap needed, the pattern itself keeps speaker triggered
    this.workletNode.port.postMessage({ type: 'PROBE_LOOP_START', ...loopParams })

    // Listen for cycle updates and auto-stop
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

          // Auto-stop check: stable levels across 2 consecutive checks
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

    // Wait for result (either auto-stop or manual STOP)
    let probeResult: { recording: Float32Array; totalFrames: number }
    try {
      probeResult = await probeResultPromise
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Probe error'
      console.warn(`Calibration: ${msg}`)
      this.callbacks.onStatus?.('Probe error — using max amplitude.')
      probeResult = { recording: new Float32Array(0), totalFrames: 0 }
    }

    this.callbacks.onProgress?.(30)

    // Analyze probe recording (one shot)
    let optimalAmplitude = 1.0
    let signalQuality: SignalQuality = 'none'
    let avgLatencyMs = 0
    let maxSample = 0
    let maxCorrelation = 0
    let latencies: number[] = []

    if (probeResult.totalFrames > 0) {
      const analysis = this.analyzeLoopRecording(
        probeResult.recording, probeResult.totalFrames, sr, floorPeak, loopParams,
      )
      optimalAmplitude = analysis.optimalAmplitude
      signalQuality = analysis.quality
      avgLatencyMs = analysis.latencyMs

      if (analysis.overallDetected) {
        latencies = analysis.segments
          .filter(s => s.detectable && s.delay > 0)
          .map(s => Math.round((s.delay / sr) * 1000))
        maxCorrelation = Math.max(...analysis.segments.map(s => s.correlation))
        maxSample = Math.max(...analysis.segments.map(s => s.peak))
      }

      if (!analysis.overallDetected) {
        console.warn('Calibration: no detectable segments — using max amplitude (1.0)')
        this.callbacks.onStatus?.('Signal not detected at any level — using maximum volume.')
      } else if (analysis.quality === 'clipping') {
        this.callbacks.onStatus?.('Signal clipping — reducing amplitude.')
      } else if (analysis.quality === 'weak') {
        this.callbacks.onStatus?.('Signal weak — using maximum amplitude.')
      } else {
        this.callbacks.onStatus?.(`Levels good. Latency: ${avgLatencyMs}ms, amplitude: ${optimalAmplitude.toFixed(2)}.`)
      }
    } else {
      this.callbacks.onStatus?.('Probe recording empty — using max amplitude.')
    }

    this.callbacks.onProgress?.(50)

    if (latencies.length === 0) {
      const error = `No valid latency measurements (max correlation ${maxCorrelation.toFixed(2)}). Ensure speakers are audible to the microphone.`
      return {
        success: false, latencyMs: 0, averageLatencyMs: 0,
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
      success, latencyMs: averageLatencyMs, sr, error,
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

if (typeof window !== 'undefined') {
  ;(window as any).__calibrationDebug = {
    run: async () => {
      const c = new LatencyCalibrator()
      return c.debugRun()
    },
  }
  console.log('LatencyCalibrator: Debug API at window.__calibrationDebug.run()')
}
