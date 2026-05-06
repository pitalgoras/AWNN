/**
 * Web Audio buffer player emulating the behavior of an HTML5 Audio element.
 */
class WebAudioPlayer {
  private audioContext: AudioContext
  private gainNode: GainNode
  private bufferNode: AudioBufferSourceNode | null = null
  private listeners: Map<string, Set<() => void>> = new Map()
  private autoplay = false
  private playStartTime = 0
  private playedDuration = 0
  private _src = ''
  private _duration = 0
  private _muted = false
  private _playbackRate = 1
  private buffer: AudioBuffer | null = null
  public paused = true
  public crossOrigin: string | null = null
  private _offset = 0 // NEW: Offset to skip (for audioOffset feature)

  constructor(audioContext: AudioContext | null = null, options?: { offset?: number }) {
    if (audioContext) {
      console.log('WebAudioPlayer constructor: using provided audioContext', audioContext.state);
    }
    this.audioContext = audioContext || new AudioContext();
    console.log('WebAudioPlayer constructor: this.audioContext =', this.audioContext);
    
    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)
    
    // NEW: Store offset from options
    if (options?.offset !== undefined) {
      this._offset = options.offset;
      console.log('WebAudioPlayer: offset set to', this._offset);
    }
  }

  addEventListener(event: string, listener: () => void, options?: { once?: boolean }) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)?.add(listener)

    if (options?.once) {
      const onOnce = () => {
        this.removeEventListener(event, onOnce)
        this.removeEventListener(event, listener)
      }
      this.addEventListener(event, onOnce)
    }
  }

  removeEventListener(event: string, listener: () => void) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)?.delete(listener)
    }
  }

  private emitEvent(event: string) {
    this.listeners.get(event)?.forEach((listener) => listener())
  }

  get src() {
    return this._src
  }

  set src(value: string) {
    this._src = value

    if (!value) {
      this.buffer = null
      this._duration = 0
      this.emitEvent('emptied')
      return
    }

    fetch(value)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => {
        if (this.src !== value) return null
        return this.audioContext.decodeAudioData(arrayBuffer.slice(0))
      })
      .then((audioBuffer) => {
        if (this.src !== value || !audioBuffer) return null

        this.buffer = audioBuffer
        this._duration = audioBuffer.duration

        this.emitEvent('loadedmetadata')
        this.emitEvent('canplay')

        if (this.autoplay) {
          this.play()
        }
      })
  }

  setBuffer(audioBuffer: AudioBuffer) {
    this.buffer = audioBuffer
    this._duration = audioBuffer.duration
    this.emitEvent('loadedmetadata')
    this.emitEvent('canplay')
    if (this.autoplay) {
      this.play()
    }
  }

  loadBuffer(url: string, audioBuffer: AudioBuffer) {
    this._src = url
    this.setBuffer(audioBuffer)
  }

  getChannelData() {
    const channelData = this.buffer?.getChannelData(0)
    return channelData ? [new Float32Array(channelData)] : undefined
  }

  async play() {
    return this.playAt(this.audioContext.currentTime)
  }

  private _loop = false

  get loop() {
    return this._loop
  }

  set loop(value: boolean) {
    this._loop = value
    if (this.bufferNode) {
      this.bufferNode.loop = value
    }
  }

  async playAt(startTime: number) {
    if (!this.paused) return
    this.paused = false

    this.bufferNode?.disconnect()
    this.bufferNode = this.audioContext.createBufferSource()
    this.bufferNode.buffer = this.buffer
    this.bufferNode.playbackRate.value = this._playbackRate
    this.bufferNode.loop = this._loop
    this.bufferNode.connect(this.gainNode)

    const duration = this.buffer?.duration || 0
    // NEW: Use this._offset to skip head + compensate latency
    const offset = Math.max(0, Math.min(this.playedDuration + this._offset, duration - 0.001))

    // COMPREHENSIVE DEBUG LOGS
    console.log('=== WebAudioPlayer.playAt DEBUG ===')
    console.log('WebAudioPlayer: startTime =', startTime)
    console.log('WebAudioPlayer: offset =', this._offset)
    console.log('WebAudioPlayer: playedDuration =', this.playedDuration)
    console.log('WebAudioPlayer: offset calculation = playedDuration + offset =', this.playedDuration + this._offset)
    console.log('WebAudioPlayer: final offset =', offset)
    console.log('WebAudioPlayer: buffer.duration =', duration)
    console.log('WebAudioPlayer: bufferNode will start at currentTime +', this.audioContext.currentTime, 'with offset =', offset)

    try {
      if (this.buffer) {
        if (offset < duration && offset >= 0) {
          console.log('WebAudioPlayer: calling bufferNode.start(', startTime, offset, ')')
          this.bufferNode.start(startTime, offset)
        } else {
          // If we are at or past the end, don't start the buffer but emit ended
          console.warn('WebAudioPlayer: offset out of range, not starting. offset=', offset, 'duration=', duration)
          setTimeout(() => this.emitEvent('ended'), 0)
        }
      } else if (this._src) {
        console.warn('WebAudioPlayer: No buffer to play', { src: this._src })
      }
    } catch (e) {
      console.error('WebAudioPlayer: Error starting bufferNode', e)
    }

    this.playStartTime = startTime
    this.emitEvent('play')
  }

  pause() {
    if (this.paused) return
    this.paused = true

    try {
      this.bufferNode?.stop()
    } catch {
      // Ignore stop errors
    }
    this.playedDuration += (this.audioContext.currentTime - this.playStartTime) * this._playbackRate
    this.emitEvent('pause')
  }

  async setSinkId(deviceId: string) {
    const ac = this.audioContext as AudioContext & { setSinkId: (id: string) => Promise<void> }
    return ac.setSinkId(deviceId)
  }

  get playbackRate() {
    return this._playbackRate
  }
  set playbackRate(value) {
    if (!this.paused) {
      this.playedDuration += (this.audioContext.currentTime - this.playStartTime) * this._playbackRate
      this.playStartTime = this.audioContext.currentTime
    }
    this._playbackRate = value
    if (this.bufferNode) {
      this.bufferNode.playbackRate.value = value
    }
  }

  get currentTime() {
    const time = this.paused ? this.playedDuration : this.playedDuration + (this.audioContext.currentTime - this.playStartTime) * this._playbackRate
    return Math.max(0, time)
  }
  set currentTime(value) {
    this.emitEvent('seeking')

    if (this.paused) {
      this.playedDuration = value
    } else {
      this.pause()
      this.playedDuration = value
      this.play()
    }

    this.emitEvent('timeupdate')
  }

  get duration() {
    return this._duration
  }
  set duration(value: number) {
    this._duration = value
  }

  get volume() {
    return this.gainNode.gain.value
  }
  set volume(value) {
    this.gainNode.gain.value = value
    this.emitEvent('volumechange')
  }

  get muted() {
    return this._muted
  }
  set muted(value: boolean) {
    if (this._muted === value) return
    this._muted = value

    if (this._muted) {
      this.gainNode.disconnect()
    } else {
      this.gainNode.connect(this.audioContext.destination)
    }
  }

  destroy() {
    this.pause()
    this.gainNode.disconnect()
    this.bufferNode?.disconnect()
    this.listeners.clear()
  }
}

export default WebAudioPlayer
