export interface ClickSchedule {
  /** AudioContext time when each click was scheduled to play */
  clickTimes: number[]
  /** BPM used for the click pattern */
  bpm: number
  /** Sample rate of AudioContext */
  sampleRate: number
}

export interface CalibrationCapture {
  /** Recorded mic frames (Float32Array) */
  frames: Float32Array
  /** AudioContext frame at recording start (worklet's currentFrame) */
  startFrame: number
  /** AudioContext frame at recording end */
  endFrame: number
  /** Click schedule for plotting on waveform */
  clicks: ClickSchedule
  /** Browser-reported output latency at calibration time */
  outputLatencyMs: number
  /** Browser-reported base latency at calibration time */
  baseLatencyMs: number
}

export class VisualCalibrator {
  private ctx: AudioContext
  private workletNode: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  async init(stream?: MediaStream): Promise<void> {
    if (stream) {
      this.stream = stream
    } else {
      const isChrome = /Chrome/.test(navigator.userAgent)
      let audio: MediaTrackConstraints
      if (isChrome) {
        audio = {
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
        } as unknown as MediaTrackConstraints
      } else {
        audio = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: this.ctx.sampleRate,
        }
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio } as MediaStreamConstraints)
      } catch {
        // Firefox may reject sampleRate constraint; retry without it
        const fallback: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: fallback })
      }
    }

    try {
      await this.ctx.audioWorklet.addModule('/worklets/calibration.worklet.js')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already been added') && !msg.includes('already registered')) throw err
    }

    this.workletNode = new AudioWorkletNode(this.ctx, 'calibration-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    })

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.workletNode)
    this.workletNode.connect(this.ctx.destination)
  }

  /**
   * Run the visual calibration.
   * Plays N clicks at the given BPM through the output,
   * records mic input, returns the capture for display.
   * @param wakeUpClicks - Extra clicks before the measurement pattern to wake BT speakers (0 = none)
   */
  async run(bpm = 120, clickCount = 8, wakeUpClicks = 0): Promise<CalibrationCapture> {
    if (!this.workletNode) throw new Error('Calibrator not initialized')

    const sr = this.ctx.sampleRate
    const beatDuration = 60 / bpm
    const clickTimes: number[] = []

    // Start worklet recording — captures everything
    this.workletNode.port.postMessage({ type: 'START' })

    const startedMsg = await new Promise<{ startFrame: number }>((resolve) => {
      this.workletNode!.port.onmessage = (e) => {
        if (e.data.type === 'STARTED') resolve(e.data)
      }
    })
    const startFrame = startedMsg.startFrame
    const startTime = startFrame / sr

    // Schedule clicks at known AudioContext times
    // First click starts at currentTime + 0.5s to give the worklet time to spin up
    const totalClicks = clickCount + wakeUpClicks
    const firstClickTime = this.ctx.currentTime + 0.5
    const oscGain = this.ctx.createGain()
    oscGain.gain.value = 0.3
    oscGain.connect(this.ctx.destination)

    for (let i = 0; i < totalClicks; i++) {
      let t = firstClickTime + i * beatDuration
      // Last measurement click arrives half-beat early — unmistakable visual anchor
      if (i === totalClicks - 1) t -= beatDuration / 2
      if (i >= wakeUpClicks) clickTimes.push(t)
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 1000
      osc.connect(oscGain)
      // 10ms click
      osc.start(t)
      osc.stop(t + 0.01)
    }

    // Wait for all clicks to finish + 1s margin
    const lastT = firstClickTime + (totalClicks - 1) * beatDuration
    const totalDuration = lastT + 1.0 - startTime
    const recordFrames = Math.ceil(totalDuration * sr)
    await new Promise((resolve) => setTimeout(resolve, totalDuration * 1000 + 200))

    // Stop worklet
    const capture = await new Promise<{ frames: Float32Array; startFrame: number; endFrame: number }>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'TRACE') {
          this.workletNode!.port.onmessage = null
          resolve(e.data)
        }
      }
      this.workletNode!.port.onmessage = handler
      this.workletNode!.port.postMessage({ type: 'STOP' })
      // Fallback timeout
      setTimeout(() => {
        if (this.workletNode) this.workletNode.port.onmessage = null
        resolve({ frames: new Float32Array(0), startFrame: 0, endFrame: 0 })
      }, 3000)
    })

    oscGain.disconnect()

    return {
      frames: capture.frames,
      startFrame: capture.startFrame,
      endFrame: capture.endFrame,
      clicks: { clickTimes, bpm, sampleRate: sr },
      outputLatencyMs: Math.round((this.ctx.outputLatency || 0) * 1000),
      baseLatencyMs: Math.round((this.ctx.baseLatency || 0) * 1000),
    }
  }

  get inputDeviceId(): string {
    return this.stream?.getAudioTracks()[0]?.getSettings()?.deviceId || 'unknown'
  }

  cleanup(): void {
    if (this.workletNode) {
      try { this.workletNode.port.close(); this.workletNode.disconnect() } catch { /* ignore */ }
      this.workletNode = null
    }
    if (this.source) {
      try { this.source.disconnect() } catch { /* ignore */ }
      this.source = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop())
      this.stream = null
    }
  }
}
