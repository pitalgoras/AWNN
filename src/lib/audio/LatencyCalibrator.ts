/**
 * LatencyCalibrator - Measures round-trip audio latency via a shared-clock
 * AudioWorklet that generates pulses and listens for them simultaneously.
 *
 * The worklet knows the exact AudioContext frame when a pulse is generated
 * and the exact frame when it arrives at the microphone. The difference
 * is the round-trip latency — no external signal generation needed.
 *
 * DEBUG API (run from browser console):
 *   __calibrationDebug.run()
 */

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

export interface DebugResult {
  success: boolean
  latenciesMs: number[]
  averageLatencyMs: number
  generationFrames: number[]
  detectedFrames: number[]
  latencyFrames: number[]
  sr: number
  error?: string
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
    | ((result: { generationFrames: number[]; detectedFrames: number[] }) => void)
    | null = null

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {},
  ) {
    this.callbacks = callbacks
    this.options = { numTests: 5, ...options }
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
        latenciesMs: [],
        averageLatencyMs: 0,
        generationFrames: [],
        detectedFrames: [],
        latencyFrames: [],
        sr: 0,
        error: msg,
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
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    const sr = this.ctx.sampleRate

    // 2. Get mic stream with raw audio constraints
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

    // 5. Set up message handler for results
    const resultPromise = new Promise<{ generationFrames: number[]; detectedFrames: number[] }>(
      (resolve) => {
        this._resolveResult = resolve
      },
    )

    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'DEBUG') {
        console.log('Calibration worklet:', event.data.msg, event.data)
      } else if (event.data.type === 'RESULT') {
        if (this._resolveResult) {
          this._resolveResult({
            generationFrames: event.data.generationFrames,
            detectedFrames: event.data.detectedFrames,
          })
          this._resolveResult = null
        }
      }
    }

    this.callbacks.onProgress?.(10)

    // 6. Send START to worklet
    this.workletNode.port.postMessage({
      type: 'START',
      numPulses: this.options.numTests,
      pulseIntervalFrames: Math.floor(0.2 * sr), // 200ms between pulses
      threshold: 0.05,
    })

    this.callbacks.onProgress?.(20)

    // 7. Wait: 0.3s initial delay + numPulses * 0.2s interval + 1s grace
    const waitMs =
      300 + this.options.numTests * 200 + 1000
    await new Promise((r) => setTimeout(r, waitMs))

    if (this.isCancelled) {
      return { success: false, latencies: [], latenciesMs: [], averageLatencyMs: 0, generationFrames: [], detectedFrames: [], latencyFrames: [], sr }
    }
    this.callbacks.onProgress?.(60)

    // 8. Send STOP, collect results
    this.workletNode.port.postMessage({ type: 'STOP' })
    const result = await resultPromise

    if (this.isCancelled) {
      return { success: false, latencies: [], latenciesMs: [], averageLatencyMs: 0, generationFrames: [], detectedFrames: [], latencyFrames: [], sr }
    }
    this.callbacks.onProgress?.(80)

    // 9. Compute latencies
    const { generationFrames, detectedFrames } = result
    const pairs = Math.min(generationFrames.length, detectedFrames.length)

    if (pairs < 2) {
      return {
        success: false,
        latencies: [],
        latenciesMs: [],
        averageLatencyMs: 0,
        generationFrames,
        detectedFrames,
        latencyFrames: [],
        sr,
        error: `Only ${pairs} pulse(s) detected (need at least 2). Ensure speakers are on and microphone can hear them.`,
      }
    }

    const latencyFrames: number[] = []
    for (let i = 0; i < pairs; i++) {
      latencyFrames.push(detectedFrames[i] - generationFrames[i])
    }

    const latenciesMs = latencyFrames.map((f) => Math.round((f / sr) * 1000))
    const avgLatency = Math.round(
      latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length,
    )

    console.log('Calibration result:', {
      generationFrames,
      detectedFrames,
      latencyFrames,
      latenciesMs,
      avgLatency,
    })

    return {
      success: true,
      latencies: latenciesMs,
      latenciesMs,
      averageLatencyMs: avgLatency,
      generationFrames,
      detectedFrames,
      latencyFrames,
      sr,
    }
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

if (typeof window !== 'undefined') {
  ;(window as any).__calibrationDebug = {
    run: async () => {
      const c = new LatencyCalibrator()
      return c.debugRun()
    },
  }
  console.log('LatencyCalibrator: Debug API at window.__calibrationDebug.run()')
}
