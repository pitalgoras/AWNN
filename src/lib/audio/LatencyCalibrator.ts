/**
 * LatencyCalibrator - Measures round-trip audio latency using a
 * unique non-regular peak pattern for reliable detection.
 *
 * Approach:
 * 1. Plays a test signal through speakers: [500ms sustain 1kHz]
 *    + [5 peaks at irregular intervals: 100, 140, 100, 100, 140ms]
 * 2. Monitors microphone input via a dedicated AudioWorklet for
 *    sample-accurate rising-edge detection
 * 3. Pattern-matches the detected edges against the expected intervals
 * 4. Computes latency as the offset between expected and detected
 *    pattern start times
 *
 * The non-regular pattern eliminates false positives from echoes,
 * ambient noise, and Bluetooth noise-gate artifacts. The sustain tone
 * wakes Bluetooth speakers before the measurement pattern begins.
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

export class LatencyCalibrator {
  private callbacks: LatencyCalibrationCallbacks
  private options: Required<LatencyCalibrationOptions>

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private isCancelled = false

  // Pattern: bit 0 → 80ms gap, bit 1 → 120ms gap (peak-to-peak intervals: 100ms, 140ms)
  private readonly PATTERN_BITS = [0, 1, 0, 0, 1]
  private readonly SUSTAIN_DURATION = 0.5     // 500ms sustain to wake Bluetooth
  private readonly PEAK_DURATION = 0.02       // 20ms per peak
  private readonly SHORT_GAP = 0.08           // 80ms (bit 0)
  private readonly LONG_GAP = 0.12            // 120ms (bit 1)
  private readonly THRESHOLD = 0.15           // min amplitude for edge detection
  private readonly MIN_GAP_SEC = 0.045        // min gap between peaks (45ms)
  private readonly TOLERANCE_SEC = 0.025      // ±25ms timing tolerance

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {},
  ) {
    this.callbacks = callbacks
    this.options = {
      numTests: 5,
      ...options,
    }
  }

  async calibrate(): Promise<void> {
    this.isCancelled = false

    try {
      // 1. Create and resume AudioContext
      this.ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume()
      }
      const sr = this.ctx.sampleRate

      // 2. Get mic stream with raw audio constraints
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
          ...(/Chrome/.test(navigator.userAgent) ? {
            googEchoCancellation: false,
            googAutoGainControl: false,
            googNoiseSuppression: false,
            googHighpassFilter: false,
            googTypingNoiseDetection: false,
          } as any : {}),
        },
      })

      // 3. Load worklet
      try {
        await this.ctx.audioWorklet.addModule('/worklets/calibration.worklet.js')
      } catch (err: any) {
        if (!err?.message?.includes('already been added')) {
          throw err
        }
      }

      // 4. Connect mic → worklet → silent gain → destination
      this.workletNode = new AudioWorkletNode(this.ctx, 'calibration-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      })
      this.source = this.ctx.createMediaStreamSource(this.stream)
      this.source.connect(this.workletNode)
      const silentGain = this.ctx.createGain()
      silentGain.gain.value = 0
      this.workletNode.connect(silentGain)
      silentGain.connect(this.ctx.destination)

      this.callbacks.onProgress?.(10)

      // 5. Compute pattern timing
      const totalPatternDuration = this.PATTERN_BITS.reduce(
        (sum, bit) => sum + this.PEAK_DURATION + (bit === 0 ? this.SHORT_GAP : this.LONG_GAP),
        0,
      )
      const totalDuration = this.SUSTAIN_DURATION + totalPatternDuration

      // 6. Send START to worklet
      const playTime = this.ctx.currentTime
      const startFrame = Math.floor((playTime + this.SUSTAIN_DURATION) * sr)
      this.workletNode.port.postMessage({
        type: 'START',
        threshold: this.THRESHOLD,
        minGapFrames: Math.floor(this.MIN_GAP_SEC * sr),
        startFrame,
      })

      // 7. Generate and play test signal
      this.playTestSignal(playTime)

      this.callbacks.onProgress?.(30)

      // 8. Wait for signal to finish + grace period
      const waitMs = (totalDuration + 1.5) * 1000
      await new Promise((r) => setTimeout(r, waitMs))

      if (this.isCancelled) return
      this.callbacks.onProgress?.(60)

      // 9. Get results from worklet
      const edges = await this.collectEdges()

      if (this.isCancelled) return
      this.callbacks.onProgress?.(80)

      // 10. Pattern matching
      const result = this.matchPattern(edges, sr, playTime)

      this.cleanup()
      this.callbacks.onComplete?.(result)
    } catch (err) {
      this.cleanup()
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onError?.(`Calibration failed: ${msg}`)
    }
  }

  private playTestSignal(playTime: number): void {
    if (!this.ctx) return

    // Build the test signal buffer
    const sr = this.ctx.sampleRate
    const totalPatternDuration = this.PATTERN_BITS.reduce(
      (sum, bit) => sum + this.PEAK_DURATION + (bit === 0 ? this.SHORT_GAP : this.LONG_GAP),
      0,
    )
    const totalDuration = this.SUSTAIN_DURATION + totalPatternDuration
    const numSamples = Math.ceil(totalDuration * sr)
    const buffer = this.ctx.createBuffer(1, numSamples, sr)
    const data = buffer.getChannelData(0)

    // Sustain tone: 500ms of 1kHz at 70%
    for (let i = 0; i < sr * this.SUSTAIN_DURATION; i++) {
      data[i] = Math.sin(2 * Math.PI * 1000 * (i / sr)) * 0.7
    }

    // Pattern peaks: emitted sequentially
    let currentTime = this.SUSTAIN_DURATION
    for (let pi = 0; pi < this.PATTERN_BITS.length; pi++) {
      const peakStart = Math.floor(currentTime * sr)
      const peakEnd = Math.floor((currentTime + this.PEAK_DURATION) * sr)
      for (let i = peakStart; i < peakEnd && i < numSamples; i++) {
        const t = (i - peakStart) / (peakEnd - peakStart)
        const envelope = 0.5 * (1 - Math.cos(Math.PI * t))
        data[i] = Math.sin(2 * Math.PI * 1000 * (i / sr)) * envelope
      }
      const gap = this.PATTERN_BITS[pi] === 0 ? this.SHORT_GAP : this.LONG_GAP
      currentTime += this.PEAK_DURATION + gap
    }

    // Play through speakers
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    source.start(0)
  }

  private collectEdges(): Promise<number[]> {
    return new Promise((resolve) => {
      if (!this.workletNode) {
        resolve([])
        return
      }
      const handler = (event: MessageEvent) => {
        if (event.data.type === 'EDGES') {
          this.workletNode!.port.onmessage = null
          resolve(event.data.edges)
        }
      }
      this.workletNode.port.onmessage = handler
      this.workletNode.port.postMessage({ type: 'STOP' })

      // Safety timeout
      setTimeout(() => {
        if (this.workletNode) this.workletNode.port.onmessage = null
        resolve([])
      }, 2000)
    })
  }

  private matchPattern(
    edges: number[],
    sr: number,
    playTime: number,
  ): LatencyCalibrationResult {
    if (edges.length < 6) {
      return {
        success: false,
        latencies: [],
        averageLatencyMs: 0,
        error: `Only ${edges.length} edges detected (need at least 6). Ensure speakers are on and microphone can hear them.`,
      }
    }

    // Expected intervals between consecutive peaks (in frames)
    const expectedIntervals = this.PATTERN_BITS.map((bit) =>
      Math.round((this.PEAK_DURATION + (bit === 0 ? this.SHORT_GAP : this.LONG_GAP)) * sr),
    )
    const toleranceFrames = Math.round(this.TOLERANCE_SEC * sr)

    let bestMatch: number[] | null = null
    let bestMatchStartIdx = -1

    // Sliding window: for each sequence of 6 consecutive edges, check 5 intervals
    for (let start = 0; start <= edges.length - 6; start++) {
      const intervals: number[] = []
      for (let i = 0; i < 5; i++) {
        intervals.push(edges[start + i + 1] - edges[start + i])
      }

      const matches = intervals.every(
        (interval, idx) => Math.abs(interval - expectedIntervals[idx]) <= toleranceFrames,
      )

      if (matches) {
        bestMatch = intervals
        bestMatchStartIdx = start
        break
      }
    }

    if (bestMatch === null) {
      return {
        success: false,
        latencies: [],
        averageLatencyMs: 0,
        error: 'Pattern not detected. Room echoes or low volume may be masking the peaks.',
      }
    }

    // Latency = first edge in pattern - expected first edge frame
    const expectedFirstEdgeFrame = Math.floor((playTime + this.SUSTAIN_DURATION) * sr)
    const actualFirstEdgeFrame = edges[bestMatchStartIdx]
    const latencyMs = Math.round(((actualFirstEdgeFrame - expectedFirstEdgeFrame) / sr) * 1000)

    // Also measure from each peak for consistency check
    const latencies: number[] = []
    for (let i = 0; i < 5; i++) {
      const expectedFrame = Math.floor((playTime + this.SUSTAIN_DURATION + (i === 0 ? 0 : expectedIntervals.slice(0, i).reduce((a, b) => a + b, 0) / sr)) * sr)
      const actualFrame = edges[bestMatchStartIdx + i]
      latencies.push(Math.round(((actualFrame - expectedFrame) / sr) * 1000))
    }

    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)

    return {
      success: true,
      latencies,
      averageLatencyMs: avgLatency,
    }
  }

  cancel(): void {
    this.isCancelled = true
    this.cleanup()
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
    if (this.source) {
      try { this.source.disconnect() } catch { /* ignore */ }
      this.source = null
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      try { this.ctx.close() } catch { /* ignore */ }
    }
    this.ctx = null
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
  }
}
