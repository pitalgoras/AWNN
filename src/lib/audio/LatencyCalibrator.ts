/**
 * LatencyCalibrator - Measures round-trip audio latency using a
 * unique non-regular peak pattern for reliable detection.
 *
 * The non-regular pattern eliminates false positives from echoes,
 * ambient noise, and Bluetooth noise-gate artifacts. The sustain tone
 * wakes Bluetooth speakers before the measurement pattern begins.
 *
 * DEBUG API (run from browser console):
 *   __calibrationDebug.run({ sustainAmplitude: 0, peakType: 'click' })
 *   Returns a promise that resolves with the full result (edges, intervals, match)
 */

export type PeakType = 'click' | 'raisedCosine' | 'square'

export interface CalibrationConfig {
  sustainAmplitude: number  // 0 = none
  sustainDuration: number   // seconds, sustain + silence
  silenceGap: number        // seconds of silence after sustain before pattern
  peakType: PeakType
  peakDuration: number      // seconds per peak
  shortGap: number          // seconds between peaks for bit 0
  longGap: number           // seconds between peaks for bit 1
  patternBits: number[]     // 0 = shortGap, 1 = longGap
  threshold: number         // worklet edge detection threshold
  minGapSec: number         // worklet min gap between edges
  toleranceSec: number      // pattern match tolerance
  rawAudio: boolean         // use raw audio constraints
}

export interface DebugResult {
  config: CalibrationConfig
  success: boolean
  edges: number[]
  intervals: number[]
  expectedIntervals: number[]
  patternMatch: boolean
  latencyMs: number | null
  latencies: number[]
  error?: string
  edgeCount: number
  sr: number
}

export interface LatencyCalibrationOptions {
  numTests?: number
}

export interface LatencyCalibrationResult {
  success: boolean
  latencies: number[]
  averageLatencyMs: number
  error?: string
}

export interface LatencyCalibrationCallbacks {
  onProgress?: (progress: number) => void
  onComplete?: (result: LatencyCalibrationResult) => void
  onError?: (error: string) => void
}

const DEFAULT_CONFIG: CalibrationConfig = {
  sustainAmplitude: 0.7,
  sustainDuration: 0.5,
  silenceGap: 0,
  peakType: 'raisedCosine',
  peakDuration: 0.02,
  shortGap: 0.08,
  longGap: 0.12,
  patternBits: [0, 1, 0, 0, 1],
  threshold: 0.05,
  minGapSec: 0.045,
  toleranceSec: 0.025,
  rawAudio: true,
}

export class LatencyCalibrator {
  private callbacks: LatencyCalibrationCallbacks
  private options: Required<LatencyCalibrationOptions>
  private cfg: CalibrationConfig = { ...DEFAULT_CONFIG }

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private isCancelled = false

  private _resolveEdges: ((edges: number[]) => void) | null = null

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {},
  ) {
    this.callbacks = callbacks
    this.options = { numTests: 5, ...options }
  }

  // ---- PUBLIC API ----

  async calibrate(): Promise<void> {
    this.isCancelled = false
    try {
      const result = await this.runCalibration()
      this.cleanup()
      this.callbacks.onComplete?.(result)
    } catch (err) {
      this.cleanup()
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onError?.(`Calibration failed: ${msg}`)
    }
  }

  /**
   * Run calibration with a custom config override and return the full
   * debug result (edges, intervals, pattern match, etc).
   * Does NOT call onComplete/onError callbacks — returns the result directly.
   */
  async debugRun(overrides: Partial<CalibrationConfig>): Promise<DebugResult> {
    this.cfg = { ...DEFAULT_CONFIG, ...overrides }
    this.isCancelled = false
    try {
      const raw = await this.runCalibration()
      // Convert LatencyCalibrationResult to DebugResult
      const cfgSnapshot = { ...this.cfg }
      const dbgResult: DebugResult = {
        config: cfgSnapshot,
        success: raw.success,
        edges: this._lastEdges,
        intervals: this._lastIntervals,
        expectedIntervals: this._lastExpectedIntervals,
        patternMatch: raw.success,
        latencyMs: raw.success ? raw.averageLatencyMs : null,
        latencies: raw.latencies,
        error: raw.error,
        edgeCount: this._lastEdges.length,
        sr: this.ctx?.sampleRate || 0,
      }
      console.log('=== Calibration Debug Result ===')
      console.log(JSON.stringify(dbgResult, null, 2))
      this.cleanup()
      return dbgResult
    } catch (err) {
      this.cleanup()
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Calibration debug run failed:', msg)
      return {
        config: { ...this.cfg },
        success: false,
        edges: [],
        intervals: [],
        expectedIntervals: [],
        patternMatch: false,
        latencyMs: null,
        latencies: [],
        error: msg,
        edgeCount: 0,
        sr: 0,
      }
    }
  }

  cancel(): void {
    this.isCancelled = true
    this.cleanup()
  }

  // ---- INTERNAL: store last result for debug ----
  private _lastEdges: number[] = []
  private _lastIntervals: number[] = []
  private _lastExpectedIntervals: number[] = []

  // ---- RUN ----
  private async runCalibration(): Promise<LatencyCalibrationResult> {
    // 1. Create and resume AudioContext
    this.ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    const sr = this.ctx.sampleRate
    const cfg = this.cfg

    // 2. Get mic stream
    if (cfg.rawAudio) {
      const ac: any = {
        echoCancellation: /Chrome/.test(navigator.userAgent) ? { exact: false } : false,
        noiseSuppression: /Chrome/.test(navigator.userAgent) ? { exact: false } : false,
        autoGainControl: /Chrome/.test(navigator.userAgent) ? { exact: false } : false,
      }
      if (/Chrome/.test(navigator.userAgent)) {
        ac.googEchoCancellation = false
        ac.googAutoGainControl = false
        ac.googNoiseSuppression = false
        ac.googHighpassFilter = false
        ac.googTypingNoiseDetection = false
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: ac })
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }

    // 3. Load worklet
    try {
      await this.ctx.audioWorklet.addModule('/worklets/calibration.worklet.js')
    } catch (err: any) {
      if (!err?.message?.includes('already been added')) throw err
    }

    // 4. Connect mic → worklet → silent gain → destination
    this.workletNode = new AudioWorkletNode(this.ctx, 'calibration-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.workletNode)
    const silentGain = this.ctx.createGain()
    silentGain.gain.value = 0
    this.workletNode.connect(silentGain)
    silentGain.connect(this.ctx.destination)

    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'DEBUG') {
        console.log('Calibration worklet:', event.data.msg, event.data)
      } else if (event.data.type === 'EDGES') {
        if (this._resolveEdges) {
          this._resolveEdges(event.data.edges)
          this._resolveEdges = null
        }
      }
    }

    this.callbacks.onProgress?.(10)

    // 5. Compute total signal duration
    const totalPatternDuration = cfg.patternBits.reduce(
      (sum, bit) => sum + cfg.peakDuration + (bit === 0 ? cfg.shortGap : cfg.longGap),
      0,
    )
    const totalDuration = cfg.sustainDuration + cfg.silenceGap + totalPatternDuration

    // 6. Send START to worklet
    const playTime = this.ctx.currentTime
    const startFrame = Math.floor((playTime + cfg.sustainDuration + cfg.silenceGap) * sr)
    this.workletNode.port.postMessage({
      type: 'START',
      threshold: cfg.threshold,
      minGapFrames: Math.floor(cfg.minGapSec * sr),
      startFrame,
    })

    // 7. Generate and play test signal
    this.playTestSignal(playTime)

    this.callbacks.onProgress?.(30)

    // 8. Wait for signal to finish + grace
    const waitMs = (totalDuration + 1.5) * 1000
    await new Promise((r) => setTimeout(r, waitMs))
    if (this.isCancelled) return { success: false, latencies: [], averageLatencyMs: 0 }
    this.callbacks.onProgress?.(60)

    // 9. Get edges
    const edges = await this.collectEdges()
    this._lastEdges = edges
    if (this.isCancelled) return { success: false, latencies: [], averageLatencyMs: 0 }
    this.callbacks.onProgress?.(80)

    // 10. Match pattern
    const result = this.matchPattern(edges, sr, playTime)
    return result
  }

  private playTestSignal(playTime: number): void {
    if (!this.ctx) return
    const sr = this.ctx.sampleRate
    const cfg = this.cfg

    const totalPatternDuration = cfg.patternBits.reduce(
      (sum, bit) => sum + cfg.peakDuration + (bit === 0 ? cfg.shortGap : cfg.longGap),
      0,
    )
    const totalDuration = cfg.sustainDuration + cfg.silenceGap + totalPatternDuration
    const numSamples = Math.ceil(totalDuration * sr)
    const buffer = this.ctx.createBuffer(1, numSamples, sr)
    const data = buffer.getChannelData(0)

    // Sustain tone
    if (cfg.sustainAmplitude > 0 && cfg.sustainDuration > 0) {
      for (let i = 0; i < sr * cfg.sustainDuration && i < numSamples; i++) {
        data[i] = Math.sin(2 * Math.PI * 1000 * (i / sr)) * cfg.sustainAmplitude
      }
    }

    // Silence gap after sustain
    let currentTime = cfg.sustainDuration + cfg.silenceGap

    // Pattern peaks
    for (let pi = 0; pi < cfg.patternBits.length; pi++) {
      const peakStart = Math.floor(currentTime * sr)
      const peakEnd = Math.floor((currentTime + cfg.peakDuration) * sr)
      for (let i = peakStart; i < peakEnd && i < numSamples; i++) {
        let envelope = 1
        if (cfg.peakType === 'raisedCosine') {
          const t = (i - peakStart) / (peakEnd - peakStart)
          envelope = 0.5 * (1 - Math.cos(Math.PI * t))
        } else if (cfg.peakType === 'click') {
          // Single cycle at the start
          const cycleLen = sr / 1000 // 1ms = 1 cycle at 1kHz
          const pos = i - peakStart
          if (pos < cycleLen) {
            envelope = 0.5 * (1 - Math.cos(Math.PI * pos / cycleLen))
          } else {
            envelope = 0 // silent for rest of peak duration
          }
        }
        data[i] = Math.sin(2 * Math.PI * 1000 * (i / sr)) * envelope
      }
      const gap = cfg.patternBits[pi] === 0 ? cfg.shortGap : cfg.longGap
      currentTime += cfg.peakDuration + gap
    }

    // Play
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    source.start(0)
  }

  private collectEdges(): Promise<number[]> {
    return new Promise((resolve) => {
      if (!this.workletNode) { resolve([]); return }
      this._resolveEdges = resolve
      this.workletNode.port.postMessage({ type: 'STOP' })
      setTimeout(() => {
        if (this._resolveEdges) {
          this._resolveEdges([])
          this._resolveEdges = null
        }
        resolve([])
      }, 2000)
    })
  }

  private matchPattern(
    edges: number[], sr: number, playTime: number,
  ): LatencyCalibrationResult {
    const cfg = this.cfg
    const expectedIntervals = cfg.patternBits.map((bit) =>
      Math.round((cfg.peakDuration + (bit === 0 ? cfg.shortGap : cfg.longGap)) * sr),
    )
    this._lastExpectedIntervals = expectedIntervals

    // Compute actual intervals between consecutive edges
    const intervals: number[] = []
    for (let i = 0; i < edges.length - 1; i++) {
      intervals.push(edges[i + 1] - edges[i])
    }
    this._lastIntervals = intervals

    console.log('Calibration matchPattern:', {
      edgeCount: edges.length,
      edges,
      intervals,
      expectedIntervals,
    })

    if (edges.length < 6) {
      return {
        success: false,
        latencies: [],
        averageLatencyMs: 0,
        error: `Only ${edges.length} edges detected (need at least 6).`,
      }
    }

    const toleranceFrames = Math.round(cfg.toleranceSec * sr)
    let bestMatch: number[] | null = null
    let bestMatchStartIdx = -1

    for (let start = 0; start <= edges.length - 6; start++) {
      const winIntervals: number[] = []
      for (let i = 0; i < 5; i++) winIntervals.push(edges[start + i + 1] - edges[start + i])

      const matches = winIntervals.every(
        (interval, idx) => Math.abs(interval - expectedIntervals[idx]) <= toleranceFrames,
      )

      if (matches) {
        bestMatch = winIntervals
        bestMatchStartIdx = start
        break
      }
    }

    if (bestMatch === null) {
      return {
        success: false, latencies: [], averageLatencyMs: 0,
        error: 'Pattern not detected.',
      }
    }

    const expectedFirstEdgeFrame = Math.floor((playTime + cfg.sustainDuration + cfg.silenceGap) * sr)
    const actualFirstEdgeFrame = edges[bestMatchStartIdx]
    const latencyMs = Math.round(((actualFirstEdgeFrame - expectedFirstEdgeFrame) / sr) * 1000)

    const latencies: number[] = []
    for (let i = 0; i < 5; i++) {
      const expectedFrame = Math.floor(
        (playTime + cfg.sustainDuration + cfg.silenceGap +
          (i === 0 ? 0 : expectedIntervals.slice(0, i).reduce((a, b) => a + b, 0) / sr)) * sr,
      )
      const actualFrame = edges[bestMatchStartIdx + i]
      latencies.push(Math.round(((actualFrame - expectedFrame) / sr) * 1000))
    }

    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)

    return { success: true, latencies, averageLatencyMs: avgLatency }
  }

  private cleanup(): void {
    if (this.workletNode) {
      try {
        this.workletNode.port.onmessage = null
        this.workletNode.port.close()
        this.workletNode.disconnect()
      } catch { /* ignore */ }
      this.workletNode = null
    }
    if (this.source) { try { this.source.disconnect() } catch { /* ignore */ } this.source = null }
    if (this.ctx && this.ctx.state !== 'closed') { try { this.ctx.close() } catch { /* ignore */ } }
    this.ctx = null
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null }
  }
}

// Expose debug API on window
if (typeof window !== 'undefined') {
  (window as any).__calibrationDebug = {
    run: async (overrides: Partial<CalibrationConfig> = {}) => {
      const c = new LatencyCalibrator()
      return c.debugRun(overrides)
    },
  }
  console.log('LatencyCalibrator: Debug API at window.__calibrationDebug.run(config)')
}
