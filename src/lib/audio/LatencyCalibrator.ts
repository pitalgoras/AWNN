/**
 * LatencyCalibrator - Measures round-trip audio latency via a single
 * 100ms burst played through speakers and detected by energy peak
 * on the microphone input.
 *
 * DEBUG API (console):
 *   __calibrationDebug.run() → DebugResult
 */

export interface LatencyCalibrationOptions {
  numTests?: number
}

export interface LatencyCalibrationResult {
  success: boolean
  averageLatencyMs: number
  error?: string
  latencies: number[]
}

export interface LatencyCalibrationCallbacks {
  onProgress?: (progress: number) => void
  onComplete?: (result: LatencyCalibrationResult) => void
  onError?: (error: string) => void
}

export interface DebugResult {
  success: boolean
  latencyMs: number
  burstStartFrame: number
  peakFrame: number
  floorPeak: number
  maxSample: number
  sr: number
  error?: string
  latencies: number[]
  averageLatencyMs: number
}

export class LatencyCalibrator {
  private callbacks: LatencyCalibrationCallbacks
  private options: Required<LatencyCalibrationOptions>

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private isCancelled = false

  private _resolveResult:
    | ((result: { burstStartFrame: number; peakFrame: number; maxSample: number; floorPeak: number }) => void)
    | null = null

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {},
  ) {
    this.callbacks = callbacks
    this.options = { numTests: 1, ...options }
  }

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
        burstStartFrame: 0,
        peakFrame: 0,
        floorPeak: 0,
        maxSample: 0,
        sr: 0,
        error: msg,
        latencies: [],
        averageLatencyMs: 0,
      }
    }
  }

  cancel(): void {
    this.isCancelled = true
    this.cleanup()
  }

  private async runCalibration(): Promise<LatencyCalibrationResult & DebugResult> {
    // 1. Create and resume AudioContext
    this.ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (this.ctx.state === 'suspended') { await this.ctx.resume() }
    const sr = this.ctx.sampleRate

    // 2. Get mic stream
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

    // 3. Load worklet
    try {
      await this.ctx.audioWorklet.addModule('/worklets/calibration.worklet.js')
    } catch (err: any) {
      if (!err?.message?.includes('already been added')) throw err
    }

    // 4. Connect mic → worklet → destination
    this.workletNode = new AudioWorkletNode(this.ctx, 'calibration-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
    })
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.workletNode)
    this.workletNode.connect(this.ctx.destination)

    // 5. Sample noise floor
    const floorPromise = new Promise<number>((resolve) => {
      this.workletNode!.port.onmessage = (e) => {
        if (e.data.type === 'FLOOR_RESULT') { resolve(e.data.peak) }
      }
    })
    this.workletNode.port.postMessage({ type: 'MEASURE_FLOOR', durationFrames: Math.floor(0.2 * sr) })
    let floorPeak = await floorPromise
    // Retry once if floor was silent (AudioContext may not have stabilized)
    if (floorPeak < 0.001) {
      console.log('Calibration: floor measurement returned near-zero, retrying...')
      await new Promise((r) => setTimeout(r, 200))
      const floorPromise2 = new Promise<number>((resolve) => {
        this.workletNode!.port.onmessage = (e) => { if (e.data.type === 'FLOOR_RESULT') { this.workletNode!.port.onmessage = null; resolve(e.data.peak) } }
      })
      this.workletNode.port.postMessage({ type: 'MEASURE_FLOOR', durationFrames: Math.floor(0.2 * sr) })
      floorPeak = await floorPromise2
    }
    if (floorPeak < 0.001) floorPeak = 0.005
    console.log(`Calibration: noise floor peak=${floorPeak.toFixed(4)}`)

    // 6. Set up result handler
    const resultPromise = new Promise<{ burstStartFrame: number; peakFrame: number; maxSample: number; floorPeak: number }>(
      (resolve) => { this._resolveResult = resolve },
    )
    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === 'DEBUG') { console.log('Calibration worklet:', e.data.msg, e.data) }
      else if (e.data.type === 'RESULT' && this._resolveResult) {
        this._resolveResult({
          burstStartFrame: e.data.burstStartFrame,
          peakFrame: e.data.peakFrame,
          maxSample: e.data.maxSample,
          floorPeak: e.data.floorPeak,
        })
        this._resolveResult = null
      }
    }

    this.callbacks.onProgress?.(10)

    // 7. Send START
    this.workletNode.port.postMessage({ type: 'START' })
    this.callbacks.onProgress?.(30)

    // 8. Wait for burst + grace
    await new Promise((r) => setTimeout(r, 2000))
    if (this.isCancelled) {
      return { success: false, latencyMs: 0, burstStartFrame: 0, peakFrame: 0, floorPeak: 0, maxSample: 0, sr, latencies: [], averageLatencyMs: 0 }
    }
    this.callbacks.onProgress?.(60)

    // 9. Get result
    this.workletNode.port.postMessage({ type: 'STOP' })
    const result = await resultPromise
    if (this.isCancelled) {
      return { success: false, latencyMs: 0, burstStartFrame: 0, peakFrame: 0, floorPeak: 0, maxSample: 0, sr, latencies: [], averageLatencyMs: 0 }
    }
    this.callbacks.onProgress?.(80)

    // 10. Compute latency
    const latencyFrames = result.peakFrame - result.burstStartFrame
    const latencyMs = Math.round((latencyFrames / sr) * 1000)

    // 11. Level diagnostics — warn but don't block on clipping
    const ratio = floorPeak > 0 ? result.maxSample / floorPeak : 0
    const issues: string[] = []
    const warnings: string[] = []
    if (ratio < 2) issues.push(`Signal too quiet (${ratio.toFixed(1)}x noise floor). Turn UP speakers or move mic CLOSER.`)
    if (result.maxSample > 0.99) warnings.push(`Near clipping (peak ${result.maxSample.toFixed(2)}). Consider lowering speaker volume or moving mic further.`)
    if (result.peakFrame <= result.burstStartFrame) issues.push('Peak frame before burst start — detection error.')

    const success = issues.length === 0 && latencyMs > 0
    const error = issues.length > 0 ? issues.join(' ') : undefined
    const fullLog = [error, ...warnings].filter(Boolean).join(' ')
      || 'Levels good.'

    console.log('Calibration result:', {
      latencyMs,
      floorPeak: result.floorPeak.toFixed(4),
      maxSample: result.maxSample.toFixed(4),
      ratio: ratio.toFixed(1),
      success,
    })
    if (warnings.length > 0) console.warn(warnings.join(' '))
    if (error) console.error(error)

    const debugResult: DebugResult = {
      success,
      latencyMs,
      burstStartFrame: result.burstStartFrame,
      peakFrame: result.peakFrame,
      floorPeak: result.floorPeak,
      maxSample: result.maxSample,
      sr,
      error,
      latencies: success ? [latencyMs] : [],
      averageLatencyMs: success ? latencyMs : 0,
    }

    const calResult: LatencyCalibrationResult = {
      success,
      averageLatencyMs: success ? latencyMs : 0,
      latencies: success ? [latencyMs] : [],
      error,
    }

    console.log('Calibration result:', { latencyMs, floorPeak: result.floorPeak.toFixed(4), maxSample: result.maxSample.toFixed(4), ratio: ratio.toFixed(1), success })
    if (error) console.warn(error)

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
