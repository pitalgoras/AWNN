/**
 * LatencyCalibrator - Measures round-trip audio latency via loopback
 *
 * Approach:
 * 1. Get microphone access with raw audio constraints
 * 2. Play 5 sharp clicks through speakers at known AudioContext times
 * 3. Capture all mic input during the test via ScriptProcessorNode
 * 4. After the test, analyze the recorded buffer for click transients
 * 5. Compute latency as (detected_time - expected_time) for each click
 * 6. Return the average of all successful detections
 */

export interface LatencyCalibrationOptions {
  numTests?: number
  testInterval?: number
  beepFrequency?: number
  beepDuration?: number
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
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private isCancelled = false

  private recordedSamples: Float32Array[] = []
  private clickTimes: number[] = []

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {},
  ) {
    this.callbacks = callbacks
    this.options = {
      numTests: 5,
      testInterval: 0.8,
      beepFrequency: 1000,
      beepDuration: 0.04,
      ...options,
    }
  }

  async calibrate(): Promise<void> {
    this.isCancelled = false
    this.recordedSamples = []
    this.clickTimes = []

    try {
      // 1. Create AudioContext and ensure it's running (user gesture required)
      this.ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)()
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume()
      }

      // 2. Get mic stream with raw audio — no echo cancellation,
      //    no noise suppression, no AGC
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
        },
      })

      // 3. Create ScriptProcessorNode to capture mic input
      this.processor = this.ctx.createScriptProcessor(1024, 1, 1)

      this.processor.onaudioprocess = (e) => {
        if (this.isCancelled) return
        // Copy input samples for later analysis
        const data = e.inputBuffer.getChannelData(0)
        this.recordedSamples.push(new Float32Array(data))
      }

      // 4. Connect mic -> processor (no output needed for capture)
      this.source = this.ctx.createMediaStreamSource(this.stream)
      this.source.connect(this.processor)
      this.processor.connect(this.ctx.destination)

      // 5. Schedule clicks
      this.scheduleClicks()

      // 6. Wait for all clicks to finish + grace period for last click to arrive
      const totalDuration =
        this.options.numTests * this.options.testInterval + 1.5
      await new Promise((r) => setTimeout(r, totalDuration * 1000))

      if (this.isCancelled) return

      // 7. Analyze the recorded buffer
      const result = this.analyze()

      this.cleanup()
      this.callbacks.onComplete?.(result)
    } catch (err) {
      this.cleanup()
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onError?.(`Calibration failed: ${msg}`)
    }
  }

  private scheduleClicks(): void {
    if (!this.ctx) return

    for (let i = 0; i < this.options.numTests; i++) {
      const clickTime = this.ctx.currentTime + 0.5 + i * this.options.testInterval
      this.clickTimes.push(clickTime)

      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'square'
      osc.frequency.value = this.options.beepFrequency

      // Sharp attack, short sustain
      gain.gain.setValueAtTime(0, clickTime)
      gain.gain.linearRampToValueAtTime(1, clickTime + 0.003)
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        clickTime + this.options.beepDuration,
      )

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(clickTime)
      osc.stop(clickTime + this.options.beepDuration + 0.01)
    }
  }

  private analyze(): LatencyCalibrationResult {
    if (this.isCancelled) {
      return { success: false, latencies: [], averageLatencyMs: 0, error: 'Cancelled' }
    }

    // Combine all recorded chunks into one buffer
    let totalLen = 0
    for (const chunk of this.recordedSamples) totalLen += chunk.length
    const buffer = new Float32Array(totalLen)
    let offset = 0
    for (const chunk of this.recordedSamples) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    if (buffer.length === 0) {
      return {
        success: false,
        latencies: [],
        averageLatencyMs: 0,
        error: 'No audio captured. Check microphone permissions.',
      }
    }

    const sampleRate = this.ctx?.sampleRate || 44100
    const detected: number[] = []

    for (const expectedTime of this.clickTimes) {
      // Convert expected time to sample frame in the recording
      // The recording starts approximately at AudioContext time 0
      // (ScriptProcessorNode starts capturing immediately)
      const expectedSample = Math.floor(expectedTime * sampleRate)

      // Search window: from expected to expected + 1.0s (covers up to 1000ms latency)
      const windowStart = Math.max(0, expectedSample)
      const windowEnd = Math.min(buffer.length, expectedSample + sampleRate)

      if (windowEnd <= windowStart) continue

      // Local peak detection: find the highest peak in the search window
      const searchWindow = buffer.subarray(windowStart, windowEnd)
      let peakVal = 0
      let peakIdx = 0

      // Skip the first 2ms to avoid detecting the oscillator's direct emission (if any)
      const skipSamples = Math.floor(0.002 * sampleRate)

      for (let i = skipSamples; i < searchWindow.length - 1; i++) {
        const abs = Math.abs(searchWindow[i])
        if (abs > peakVal && abs > 0.02) {
          peakVal = abs
          peakIdx = i
        }
      }

      if (peakVal > 0.02) {
        // Refine: interpolate around peak for sub-sample accuracy
        const refined = this.refinePeak(searchWindow, peakIdx)
        const detectedSample = windowStart + refined
        const detectedTime = detectedSample / sampleRate
        const latencyMs = (detectedTime - expectedTime) * 1000

        if (latencyMs > 0 && latencyMs < 1000) {
          detected.push(Math.round(latencyMs))
        }
      }
    }

    const success = detected.length >= 2
    const avg = success
      ? Math.round(detected.reduce((a, b) => a + b, 0) / detected.length)
      : 0

    console.log('LatencyCalibrator: result', {
      success,
      detected,
      avg,
      totalRecordedSamples: buffer.length,
      clickTimes: this.clickTimes,
    })

    return {
      success,
      latencies: detected,
      averageLatencyMs: avg,
      error: success
        ? undefined
        : 'Could not detect test clicks. Make sure your speakers are on and your microphone can hear them.',
    }
  }

  /** Parabolic peak interpolation for sub-sample accuracy */
  private refinePeak(buffer: Float32Array, idx: number): number {
    if (idx < 1 || idx >= buffer.length - 1) return idx
    const y0 = Math.abs(buffer[idx - 1])
    const y1 = Math.abs(buffer[idx])
    const y2 = Math.abs(buffer[idx + 1])
    const denom = 2 * (y0 - 2 * y1 + y2)
    if (Math.abs(denom) < 1e-10) return idx
    return idx + (y0 - y2) / denom
  }

  cancel(): void {
    this.isCancelled = true
    this.cleanup()
  }

  private cleanup(): void {
    if (this.source) {
      try {
        this.source.disconnect()
      } catch { /* ignore */ }
      this.source = null
    }
    if (this.processor) {
      try {
        this.processor.disconnect()
        this.processor.onaudioprocess = null
      } catch { /* ignore */ }
      this.processor = null
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        this.ctx.close()
      } catch { /* ignore */ }
    }
    this.ctx = null
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    this.recordedSamples = []
  }
}
