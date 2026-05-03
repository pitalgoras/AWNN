import WaveSurfer, { type WaveSurferOptions } from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import TimelinePlugin, { type TimelinePluginOptions } from 'wavesurfer.js/dist/plugins/timeline.js'
import EnvelopePlugin, { type EnvelopePoint, type EnvelopePluginOptions } from 'wavesurfer.js/dist/plugins/envelope.js'
import EventEmitter from 'wavesurfer.js/dist/event-emitter.js'
import { makeDraggable } from 'wavesurfer.js/dist/draggable.js'
import WebAudioPlayer from './webaudio.js'

export type TrackId = string | number

type SingleTrackOptions = Omit<
  WaveSurferOptions,
  'container' | 'minPxPerSec' | 'duration' | 'cursorColor' | 'cursorWidth' | 'interact' | 'hideScrollbar'
>

import { perfLogger } from '../../utils/PerformanceLogger'

export type TrackOptions = {
  id: TrackId
  trackId?: string
  url?: string
  audioBuffer?: AudioBuffer
  peaks?: WaveSurferOptions['peaks']
  envelope?: boolean | EnvelopePoint[]
  draggable?: boolean
  startPosition: number
  startCue?: number
  endCue?: number
  fadeInEnd?: number
  fadeOutStart?: number
  volume?: number
  markers?: Array<{
    time: number
    label?: string
    color?: string
  }>
  intro?: {
    endTime: number
    label?: string
    color?: string
  }
  options?: Omit<SingleTrackOptions, 'media'> & { media?: unknown }
}

export type MultitrackOptions = {
  container: HTMLElement
  minPxPerSec?: number
  cursorColor?: string
  cursorWidth?: number
  trackBackground?: string
  trackBorderColor?: string
  rightButtonDrag?: boolean
  dragBounds?: boolean
  audioContext?: AudioContext
  envelopeOptions?: EnvelopePluginOptions
  timelineOptions?: TimelinePluginOptions
  preRollDuration?: number
  bpm?: number
  timeSignature?: [number, number]
  moveLocked?: boolean
}

export type MultitrackEvents = {
  canplay: []
  'start-position-change': [{ id: TrackId; startPosition: number }]
  'start-cue-change': [{ id: TrackId; startCue: number }]
  'end-cue-change': [{ id: TrackId; endCue: number }]
  'fade-in-change': [{ id: TrackId; fadeInEnd: number }]
  'fade-out-change': [{ id: TrackId; fadeOutStart: number }]
  'envelope-points-change': [{ id: TrackId; points: EnvelopePoint[] }]
  'volume-change': [{ id: TrackId; volume: number }]
  'intro-end-change': [{ id: TrackId; endTime: number }]
  drop: [{ id: TrackId }]
  currentTime: [number]
  click: [{ id: TrackId }]
}

export type MultitrackTracks = Array<TrackOptions>

const PLACEHOLDER_TRACK = {
  id: 'placeholder',
  url: 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV',
  peaks: [[0]],
  startPosition: 0,
  options: { height: 0 },
}

class MultiTrack extends EventEmitter<MultitrackEvents> {
  public tracks: MultitrackTracks
  public options: MultitrackOptions
  public audios: Array<HTMLAudioElement | WebAudioPlayer> = []
  public wavesurfers: Array<WaveSurfer> = []
  public envelopes: Array<EnvelopePlugin> = []
  public durations: Array<number> = []
  public currentTime = 0
  public maxDuration = 0
  public rendering: ReturnType<typeof initRendering>
  public isRecording = false
  private frameRequest: number | null = null
  private subscriptions: Array<() => void> = []
  private audioContext: AudioContext
  public onDebug?: (log: string) => void

  static create(tracks: MultitrackTracks, options: MultitrackOptions): MultiTrack {
    return new MultiTrack(tracks, options)
  }

  constructor(tracks: MultitrackTracks, options: MultitrackOptions) {
    super()

    this.audioContext = options.audioContext || new AudioContext()

    this.tracks = tracks.concat({ ...PLACEHOLDER_TRACK }).map((track) => ({
      ...track,
      startPosition: track.startPosition || 0,
      peaks: track.peaks || (track.url || track.options?.media ? undefined : [new Float32Array([0])]),
    }))
    this.options = options

    this.rendering = initRendering(this.tracks, this.options)

    this.rendering.addDropHandler((trackId: TrackId) => {
      this.emit('drop', { id: trackId })
    })

    this.initAllAudios().then((durations) => {
      this.initDurations(durations)

      this.initAllWavesurfers()
      this.rendering.setMainWidth(durations, this.maxDuration, this.options, this.currentTime)

      this.rendering.containers.forEach((container, index) => {
        if (tracks[index]?.draggable) {
          const unsubscribe = initDragging(
            container,
            (delta: number) => this.onDrag(index, delta),
            options.rightButtonDrag,
          )
          this.wavesurfers[index].once('destroy', unsubscribe)
        }
      })

      this.rendering.addClickHandler((position) => {
        this.seekTo(position)
      })

      Promise.all(this.wavesurfers.map(ws => new Promise(resolve => ws.once('ready', resolve)))).then(() => {
        this.emit('canplay')
      })
    })
  }

  private initDurations(durations: number[]) {
    this.durations = durations

    this.maxDuration = this.tracks.reduce((max, track, index) => {
      if (track.id === PLACEHOLDER_TRACK.id) return max
      return Math.max(max, track.startPosition + durations[index])
    }, 0)

    // Add 10 minutes (600 seconds) buffer to match TimelineGrid and allow scrolling/clicking beyond the end of the audio
    this.maxDuration += 600

    const placeholderAudioIndex = this.audios.findIndex((a) => a.src === PLACEHOLDER_TRACK.url)
    const placeholderAudio = this.audios[placeholderAudioIndex]
    if (placeholderAudio) {
      ;(placeholderAudio as WebAudioPlayer & { duration: number }).duration = this.maxDuration
      this.durations[placeholderAudioIndex] = this.maxDuration
    }

    this.rendering.setMainWidth(durations, this.maxDuration, this.options, this.currentTime)
  }

  private initAudio(track: TrackOptions): Promise<HTMLAudioElement | WebAudioPlayer> {
    perfLogger.log(2, track.trackId || track.id);
    const audio = (track.options?.media as HTMLAudioElement | WebAudioPlayer) || new WebAudioPlayer(this.audioContext)

    audio.crossOrigin = 'anonymous'

    if (track.audioBuffer && audio instanceof WebAudioPlayer && track.url) {
      audio.loadBuffer(track.url, track.audioBuffer)
    } else if (track.url) {
      audio.src = track.url
    }

    if (track.volume !== undefined) audio.volume = track.volume

    return new Promise<HTMLAudioElement | WebAudioPlayer>((resolve) => {
      if (!audio.src) return resolve(audio)
      if (track.audioBuffer && audio instanceof WebAudioPlayer) return resolve(audio)
      ;(audio as HTMLAudioElement).addEventListener('loadedmetadata', () => resolve(audio), { once: true })
    })
  }

  private async initAllAudios(): Promise<number[]> {
    perfLogger.log(14);
    this.audios = await Promise.all(this.tracks.map((track) => this.initAudio(track)))
    return this.audios.map((a) => (a.src ? a.duration : 0))
  }

  private initWavesurfer(track: TrackOptions, index: number): WaveSurfer {
    perfLogger.log(15, track.id);
    const container = this.rendering.containers[index]

    // Create a wavesurfer instance
    const ws = WaveSurfer.create({
      ...track.options,
      container,
      minPxPerSec: 0,
      media: this.audios[index] as HTMLMediaElement,
      peaks:
        (track.peaks
          ? track.peaks.map((p) => (p instanceof Float32Array ? new Float32Array(p) : p))
          : undefined) ||
        (this.audios[index] instanceof WebAudioPlayer
          ? (this.audios[index] as WebAudioPlayer).getChannelData()
          : undefined),
      duration: this.durations[index] || 0.001,
      cursorColor: 'transparent',
      cursorWidth: 0,
      interact: false,
      hideScrollbar: true,
    })

    if (track.id === PLACEHOLDER_TRACK.id) {
      ws.registerPlugin(
        TimelinePlugin.create({
          container: this.rendering.containers[0].parentElement!,
          ...this.options.timelineOptions,
        } as TimelinePluginOptions),
      )
    }

    // Regions and markers
    const wsRegions = RegionsPlugin.create()
    ws.registerPlugin(wsRegions)

    this.subscriptions.push(
      ws.once('decode', () => {
        perfLogger.log(3, track.trackId || track.id, track.id);
        // Start and end cues
        if (track.startCue != null || track.endCue != null) {
          const { startCue = 0, endCue = this.durations[index] } = track
          const startCueRegion = wsRegions.addRegion({
            start: 0,
            end: startCue,
            color: 'rgba(0, 0, 0, 0.7)',
            drag: false,
          })
          const endCueRegion = wsRegions.addRegion({
            start: endCue,
            end: this.durations[index],
            color: 'rgba(0, 0, 0, 0.7)',
            drag: false,
          })

          // Allow resizing only from one side
          startCueRegion.element.firstElementChild?.remove()
          endCueRegion.element.lastChild?.remove()

          // Update the start and end cues on resize
          this.subscriptions.push(
            startCueRegion.on('update-end', () => {
              track.startCue = startCueRegion.end
              this.emit('start-cue-change', { id: track.id, startCue: track.startCue as number })
            }),

            endCueRegion.on('update-end', () => {
              track.endCue = endCueRegion.start
              this.emit('end-cue-change', { id: track.id, endCue: track.endCue as number })
            }),
          )
        }

        // Intro
        if (track.intro) {
          const introRegion = wsRegions.addRegion({
            start: 0,
            end: track.intro.endTime,
            content: track.intro.label,
            color: this.options.trackBackground,
            drag: false,
          })
          introRegion.element.querySelector('[part*="region-handle-left"]')?.remove()
          ;(introRegion.element.parentElement as HTMLElement).style.mixBlendMode = 'plus-lighter'
          if (track.intro.color) {
            const rightHandle = introRegion.element.querySelector('[part*="region-handle-right"]') as HTMLElement
            if (rightHandle) {
              rightHandle.style.borderColor = track.intro.color
            }
          }

          this.subscriptions.push(
            introRegion.on('update-end', () => {
              this.emit('intro-end-change', { id: track.id, endTime: introRegion.end })
            }),
          )
        }

        // Render markers
        if (track.markers) {
          track.markers.forEach((marker) => {
            wsRegions.addRegion({
              start: marker.time,
              content: marker.label,
              color: marker.color,
              resize: false,
            })
          })
        }
      }),
    )

    if (track.envelope) {
      // Envelope
      const envelope = ws.registerPlugin(
        EnvelopePlugin.create({
          ...this.options.envelopeOptions,
          volume: track.volume,
        }),
      )

      if (Array.isArray(track.envelope)) {
        envelope.setPoints(track.envelope)
      }

      if (track.fadeInEnd) {
        if (track.startCue) {
          envelope.addPoint({ time: track.startCue || 0, volume: 0, id: 'startCue' })
        }
        envelope.addPoint({ time: track.fadeInEnd || 0, volume: track.volume ?? 1, id: 'fadeInEnd' })
      }

      if (track.fadeOutStart) {
        envelope.addPoint({ time: track.fadeOutStart, volume: track.volume ?? 1, id: 'fadeOutStart' })
        if (track.endCue) {
          envelope.addPoint({ time: track.endCue, volume: 0, id: 'endCue' })
        }
      }

      this.envelopes[index] = envelope

      const setPointTimeById = (id: string, time: number) => {
        const points = envelope.getPoints()
        const newPoints = points.map((point) => {
          if (point.id === id) {
            return { ...point, time }
          }
          return point
        })
        envelope.setPoints(newPoints)
      }

      let prevFadeInEnd = track.fadeInEnd
      let prevFadeOutStart = track.fadeOutStart

      this.subscriptions.push(
        envelope.on('volume-change', (volume) => {
          this.emit('volume-change', { id: track.id, volume })
        }),

        envelope.on('points-change', (points) => {
          const fadeIn = points.find((point) => point.id === 'fadeInEnd')
          if (fadeIn && fadeIn.time !== prevFadeInEnd) {
            this.emit('fade-in-change', { id: track.id, fadeInEnd: fadeIn.time })
            prevFadeInEnd = fadeIn.time
          }

          const fadeOut = points.find((point) => point.id === 'fadeOutStart')
          if (fadeOut && fadeOut.time !== prevFadeOutStart) {
            this.emit('fade-out-change', { id: track.id, fadeOutStart: fadeOut.time })
            prevFadeOutStart = fadeOut.time
          }

          this.emit('envelope-points-change', { id: track.id, points })
        }),

        this.on('start-cue-change', ({ id, startCue }) => {
          if (id === track.id) {
            setPointTimeById('startCue', startCue)
          }
        }),

        this.on('end-cue-change', ({ id, endCue }) => {
          if (id === track.id) {
            setPointTimeById('endCue', endCue)
          }
        }),

        ws.on('decode', () => {
          envelope.setVolume(track.volume ?? 1)
        }),
      )
    }

    ws.on('click', () => {
      this.emit('click', { id: track.id })
    })

    return ws
  }

  private initAllWavesurfers() {
    const wavesurfers = this.tracks.map((track, index) => {
      return this.initWavesurfer(track, index)
    })

    this.wavesurfers = wavesurfers
  }

  private updatePosition(time: number, autoCenter = false) {
    const precisionSeconds = 0.05
    const isPaused = !this.isPlaying()

    this.currentTime = time
    this.rendering.updateCursor(time / this.maxDuration, autoCenter)
    this.emit('currentTime', time)

    // Update the current time of each audio
    this.tracks.forEach((track, index) => {
      const audio = this.audios[index]
      const duration = this.durations[index]
      if (!audio || duration === undefined) return

      const newTime = time - track.startPosition

      // If the position is out of the track bounds, pause it
      if (isPaused || newTime > duration) {
        if (!audio.paused) {
          audio.pause()
        }
        // Update currentTime even when paused so wavesurfer cursors update
        if (newTime >= 0 && newTime <= duration && Math.abs(audio.currentTime - newTime) > precisionSeconds) {
          audio.currentTime = Math.max(0, newTime)
        } else if (newTime < 0 && audio.currentTime !== 0) {
          audio.currentTime = 0
        } else if (newTime > duration && audio.currentTime !== duration) {
          audio.currentTime = duration
        }
      } else {
        // If the position is in the track bounds, play it
        if (!isPaused && audio.paused) {
          const webaudio = audio as WebAudioPlayer
          if (typeof webaudio.playAt === 'function' && this.audioContext) {
            audio.currentTime = Math.max(0, newTime)
            // If we are already playing, we should start immediately or at the scheduled time
            const startTime = newTime < 0 ? this.audioContext.currentTime - newTime : this.audioContext.currentTime
            webaudio.playAt(startTime)
          } else if (newTime >= 0) {
            audio.currentTime = Math.max(0, newTime)
            audio.play()
          }
        } else if (newTime >= 0 && Math.abs(audio.currentTime - newTime) > precisionSeconds) {
          // Only sync if the drift is significant to avoid glitches
          audio.currentTime = Math.max(0, newTime)
        }
      }

      // Unmute if cue is reached
      const isMuted = newTime < (track.startCue || 0) || newTime > (track.endCue || Infinity)
      if (isMuted != audio.muted) audio.muted = isMuted
    })
  }

  private onDrag(index: number, delta: number) {
    const track = this.tracks[index]
    if (this.options.moveLocked || !track.draggable) {
      this.rendering.setContainerOffsets()
      return
    }

    const newStartPosition = track.startPosition + delta * this.maxDuration
    const minStart = this.options.dragBounds ? 0 : -this.durations[index] - 1
    const maxStart = this.maxDuration - this.durations[index]

    if (newStartPosition >= minStart && newStartPosition <= maxStart) {
      track.startPosition = newStartPosition
      this.initDurations(this.durations)
      this.rendering.setContainerOffsets()
      this.updatePosition(this.currentTime)
      this.emit('start-position-change', { id: track.id, startPosition: newStartPosition })
    }
  }

  private findCurrentTracks(): number[] {
    // Find the audios at the current time
    const indexes: number[] = []

    this.tracks.forEach((track, index) => {
      const duration = this.durations[index]
      if (duration === undefined) return

      if (
        (track.url || track.options?.media) &&
        this.currentTime >= track.startPosition &&
        this.currentTime < track.startPosition + duration
      ) {
        indexes.push(index)
      }
    })

    return indexes
  }

  private _isPlaying = false;

  private startSync(startAt: number) {
    const startAudioTime = startAt
    const startMultitrackTime = this.currentTime

    const onFrame = () => {
      if (!this._isPlaying) return

      const now = this.audioContext.currentTime
      // Only start moving the playhead when the scheduled audio start time is reached
      const elapsed = Math.max(0, now - startAudioTime)
      const position = startMultitrackTime + elapsed * this.getAudioRate()

      if (position !== this.currentTime) {
        this.updatePosition(position, true)
      }

      this.frameRequest = requestAnimationFrame(onFrame)
    }

    this.frameRequest = requestAnimationFrame(onFrame)
  }

  public play(startTime?: number) {
    this._isPlaying = true;
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    // Schedule all tracks to start slightly in the future to ensure perfect sync
    const startAt = startTime || (this.audioContext ? this.audioContext.currentTime + 0.1 : 0);
    
    this.startSync(startAt)

    const indexes = this.findCurrentTracks()
    
    indexes.forEach((index) => {
      const audio = this.audios[index] as WebAudioPlayer;
      if (audio && typeof audio.playAt === 'function') {
        audio.playAt(startAt)
      } else if (audio) {
        audio.play()
      }
    })
  }

  public pause() {
    this._isPlaying = false;
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
    }
    this.audios.forEach((audio) => audio.pause())
  }

  /**
   * Gets the current playback rate of the audio tracks.
   * @returns The playback rate of the first audio track, or 1 if no tracks exist.
   */
  public getAudioRate(): number {
    return this.audios.length > 0 ? this.audios[0].playbackRate : 1
  }

  /**
   * Sets the playback rate for all audio tracks to maintain synchronization.
   * @param rate The playback rate (between 0.25 and 5.0).
   * @throws {Error} If the rate is outside the valid range.
   */
  public setAudioRate(rate: number) {
    if (rate < 0.25 || rate > 5.0) {
      throw new Error('Playback rate must be between 0.25 and 5.0')
    }
    this.audios.forEach((audio) => {
      audio.playbackRate = rate
    })
  }

  public isPlaying() {
    return this._isPlaying;
  }

  public getCurrentTime() {
    return this.currentTime
  }

  /** Position percentage from 0 to 1 */
  public seekTo(position: number) {
    this.updatePosition(position * this.maxDuration)
  }

  /** Set time in seconds */
  public setTime(time: number) {
    this.updatePosition(time)
  }

  public setOptions(options: Partial<MultitrackOptions>) {
    this.options = { ...this.options, ...options }
    if (this.rendering && typeof this.rendering.setOptions === 'function') {
      this.rendering.setOptions(this.options)
    }
  }

  public zoom(pxPerSec: number, centerPlayhead = false) {
    this.options.minPxPerSec = pxPerSec
    this.wavesurfers.forEach((ws, index) => {
      if (this.tracks[index].url) {
        try {
          ws.zoom(pxPerSec);
        } catch {
          // ignore
        }
      }
    });
    this.rendering.setMainWidth(this.durations, this.maxDuration, this.options, this.currentTime)
    this.rendering.setContainerOffsets()
    this.rendering.updateCursor(this.currentTime / this.maxDuration, false, centerPlayhead)
  }

  public setMainWidth(durations: number[], maxDuration: number, options: MultitrackOptions, currentTime?: number) {
    this.rendering.setMainWidth(durations, maxDuration, options, currentTime ?? this.currentTime)
  }

  public addTrack(track: TrackOptions) {
    perfLogger.log(16, track.trackId || track.id);
    const index = this.tracks.findIndex((t) => t.id === track.id)
    if (index !== -1) {
      this.tracks[index] = track

      this.initAudio(track).then((audio) => {
        this.audios[index] = audio
        this.durations[index] = audio.duration
        this.initDurations(this.durations)
        const container = this.rendering.containers[index]
        container.innerHTML = ''

        this.wavesurfers[index].destroy()
        this.wavesurfers[index] = this.initWavesurfer(track, index)

        const unsubscribe = initDragging(
          container,
          (delta: number) => this.onDrag(index, delta),
          this.options.rightButtonDrag,
        )
        this.wavesurfers[index].once('destroy', unsubscribe)

        this.wavesurfers[index].once('ready', () => {
          this.emit('canplay')
        })
      })
    }
  }

  public setRecordingMode(isRecording: boolean) {
    this.isRecording = isRecording
    this.rendering.setRecordingMode(isRecording)
  }

  public destroy() {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest)

    this.rendering.destroy()

    this.audios.forEach((audio) => {
      audio.pause()
      audio.src = ''
      if (audio instanceof WebAudioPlayer) {
        audio.destroy()
      }
    })

    this.wavesurfers.forEach((ws) => {
      ws.destroy()
    })
  }

  // See https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId
  public setSinkId(sinkId: string): Promise<void[]> {
    return Promise.all(this.wavesurfers.map((ws) => ws.setSinkId(sinkId)))
  }

  public setTrackVolume(index: number, volume: number) {
    ;(this.envelopes[index] || this.wavesurfers[index])?.setVolume(volume)
  }

  public setTrackStartPosition(index: number, value: number) {
    const track = this.tracks[index]
    const duration = this.durations[index]
    if (!track || duration === undefined) return

    const newStartPosition = value
    if (track.startPosition === newStartPosition) return;
    
    const minStart = this.options.dragBounds ? 0 : -duration - 1
    const maxStart = this.maxDuration - duration

    if (newStartPosition >= minStart && newStartPosition <= maxStart) {
      track.startPosition = newStartPosition
      this.initDurations(this.durations)
      this.rendering.setContainerOffsets()
      this.updatePosition(this.currentTime)
      this.emit('start-position-change', { id: track.id, startPosition: newStartPosition })
    }
  }

  public getEnvelopePoints(trackIndex: number): EnvelopePoint[] | undefined {
    return this.envelopes[trackIndex]?.getPoints()
  }

  public setEnvelopePoints(trackIndex: number, points: EnvelopePoint[]) {
    this.envelopes[trackIndex]?.setPoints(points)
  }
}

function initRendering(tracks: MultitrackTracks, options: MultitrackOptions) {
  perfLogger.log(5);
  let pxPerSec = options.minPxPerSec || 50
  let durations: number[] = []
  let mainWidth = 0
  let currentOptions = { ...options }
  
  const getPreRollDuration = () => {
    if (currentOptions.preRollDuration !== undefined) return currentOptions.preRollDuration
    const bpm = currentOptions.bpm || 120
    const beatsPerBar = currentOptions.timeSignature?.[0] || 4
    return (60 / bpm) * beatsPerBar
  }

  let maxDuration = 1
  
  // Create a common container for all tracks
  const scroll = document.createElement('div')
  scroll.className = 'multitrack-scroll-container'
  scroll.setAttribute('style', 'width: 100%; overflow-x: scroll; overflow-y: hidden; user-select: none; position: relative;')
  
  // Initialize scrollLeft immediately if possible
  const initialPreRollPixels = getPreRollDuration() * pxPerSec;
  scroll.scrollLeft = initialPreRollPixels;

  let isRecording = false;

  scroll.addEventListener('scroll', () => {
    if (!isRecording) {
      const preRollPixels = getPreRollDuration() * pxPerSec;
      if (scroll.scrollLeft < preRollPixels - 1) {
        scroll.scrollLeft = preRollPixels;
      }
    }
  });

  const wrapper = document.createElement('div')
  wrapper.setAttribute('style', 'position: relative; min-height: 100%;')
  scroll.appendChild(wrapper)
  options.container.appendChild(scroll)

  // Create a common cursor
  const cursor = document.createElement('div')
  cursor.setAttribute('style', 'height: 100%; position: absolute; z-index: 10; top: 0; left: 0; pointer-events: none;')
  cursor.style.backgroundColor = options.cursorColor || '#000'
  cursor.style.width = `${options.cursorWidth ?? 1}px`
  wrapper.appendChild(cursor)

  // Create containers for each track
  const containers = tracks.map((track, index) => {
    const container = document.createElement('div')
    container.style.position = 'relative'

    if (track.id === PLACEHOLDER_TRACK.id) {
      container.style.display = 'none'
    }

    if (options.trackBorderColor && index > 0) {
      const borderDiv = document.createElement('div')
      borderDiv.setAttribute('style', `width: 100%; height: 2px; background-color: ${options.trackBorderColor}`)
      wrapper.appendChild(borderDiv)
    }

    if (options.trackBackground && (track.url || track.options?.media)) {
      container.style.background = options.trackBackground
    }

    // No audio on this track, so make it droppable
    if (!(track.url || track.options?.media)) {
      const dropArea = document.createElement('div')
      dropArea.setAttribute(
        'style',
        `position: absolute; z-index: 10; left: 10px; top: 10px; right: 10px; bottom: 10px; border: 2px dashed ${options.trackBorderColor};`,
      )
      dropArea.addEventListener('dragover', (e) => {
        e.preventDefault()
        dropArea.style.background = options.trackBackground || ''
      })
      dropArea.addEventListener('dragleave', (e) => {
        e.preventDefault()
        dropArea.style.background = ''
      })
      dropArea.addEventListener('drop', (e) => {
        e.preventDefault()
        dropArea.style.background = ''
      })
      container.appendChild(dropArea)
    }

    wrapper.appendChild(container)

    return container
  })

  // Set the positions of each container
  const setContainerOffsets = () => {
    containers.forEach((container, i) => {
      const offset = tracks[i].startPosition * pxPerSec
      if (durations[i]) {
        container.style.width = `${durations[i] * pxPerSec}px`
      }
      container.style.transform = `translateX(${offset}px)`
    })
  }

  return {
    containers,

    // Set the start offset
    setContainerOffsets,

    // Set the container width
    setMainWidth: (trackDurations: number[], maxDurationArg: number, options: MultitrackOptions, currentTime: number) => {
      currentOptions = { ...options }
      maxDuration = maxDurationArg
      durations = trackDurations
      pxPerSec = currentOptions.minPxPerSec || 50
      mainWidth = pxPerSec * maxDuration
      wrapper.style.width = `${mainWidth}px`
      
      // Set initial scroll to hide pre-roll
      const preRollPixels = getPreRollDuration() * pxPerSec;
      if (!isRecording && scroll.scrollLeft < preRollPixels) {
        scroll.scrollLeft = preRollPixels;
      }
      
      setContainerOffsets()
      
      // Update cursor position to match new layout
      const position = maxDuration > 0 ? currentTime / maxDuration : 0;
      cursor.style.left = `${Math.min(100, position * 100)}%`;
    },

    // Update cursor position
    updateCursor: (position: number, autoCenter: boolean, forceCenter = false) => {
      cursor.style.left = `${Math.min(100, position * 100)}%`

      // Update scroll
      const { clientWidth, scrollLeft } = scroll
      const center = clientWidth / 2
      const minScroll = autoCenter ? center : clientWidth
      const pos = position * mainWidth
      
      const preRollPixels = getPreRollDuration() * pxPerSec;

      // If position is in Bar 0 (pre-roll), scrollLeft should be 0
      if (position * maxDuration < getPreRollDuration()) {
          if (isRecording) {
            scroll.scrollLeft = 0;
          } else {
            scroll.scrollLeft = preRollPixels;
          }
      } else {
          if (forceCenter || pos > scrollLeft + minScroll || pos < scrollLeft) {
            const targetScroll = pos - center;
            scroll.scrollLeft = Math.max(isRecording ? 0 : preRollPixels, targetScroll);
          }
      }
    },

    setOptions: (options: Partial<MultitrackOptions>) => {
      currentOptions = { ...currentOptions, ...options }
      pxPerSec = currentOptions.minPxPerSec || pxPerSec
    },

    setRecordingMode: (recording: boolean) => {
      isRecording = recording;
      if (!isRecording) {
        const preRollPixels = getPreRollDuration() * pxPerSec;
        if (scroll.scrollLeft < preRollPixels) {
          scroll.scrollLeft = preRollPixels;
        }
      }
    },

    // Click to seek
    addClickHandler: (onClick: (position: number) => void) => {
      scroll.addEventListener('click', (e) => {
        if (maxDuration <= 0) return
        
        // If we clicked on a phrase or something else that should handle its own click, ignore
        if (e.target !== scroll && e.target !== wrapper) {
          // Check if target is a child of a track container
          let target = e.target as HTMLElement | null;
          while (target && target !== wrapper) {
            if (target.classList.contains('multitrack-track-container')) {
              // If it's a track container but NOT a phrase, we can still seek
              if ((e.target as HTMLElement).classList.contains('multitrack-phrase')) return;
              break;
            }
            target = target.parentElement;
          }
        }

        const rect = wrapper.getBoundingClientRect()
        const x = e.clientX - rect.left
        let position = x / (wrapper.offsetWidth || 1)
        
        // Prevent seeking into pre-roll if not recording
        if (!isRecording) {
          const preRollPixels = getPreRollDuration() * pxPerSec
          if (x < preRollPixels - 1) {
            position = getPreRollDuration() / maxDuration
          }
        }
        
        onClick(Math.max(0, Math.min(1, position)))
      })
    },

    // Destroy the container
    destroy: () => {
      scroll.remove()
    },

    // Do something on drop
    addDropHandler: (onDrop: (trackId: TrackId) => void) => {
      tracks.forEach((track, index) => {
        if (!(track.url || track.options?.media)) {
          const droppable = containers[index].querySelector('div')
          droppable?.addEventListener('drop', (e) => {
            e.preventDefault()
            onDrop(track.id)
          })
        }
      })
    },
  }
}

function initDragging(container: HTMLElement, onDrag: (delta: number) => void, rightButtonDrag = false) {
  let overallWidth = 0

  const unsubscribe = makeDraggable(
    container,
    (dx: number) => {
      onDrag(dx / overallWidth)
    },
    () => {
      container.style.cursor = 'grabbing'
      overallWidth = container.parentElement?.offsetWidth ?? 0
    },
    () => {
      container.style.cursor = 'grab'
    },
    5,
    rightButtonDrag ? 2 : 0,
  )

  const preventDefault = (e: Event) => e.preventDefault()

  container.style.cursor = 'grab'

  if (rightButtonDrag) {
    container.addEventListener('contextmenu', preventDefault)
  }

  return () => {
    container.style.cursor = ''
    unsubscribe()
    if (rightButtonDrag) {
      container.removeEventListener('contextmenu', preventDefault)
    }
  }
}

export default MultiTrack
