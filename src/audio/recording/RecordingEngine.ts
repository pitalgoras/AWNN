 /**
  * RecordingEngine - Encapsulates all recording logic
  * Extracted from useAudioEngine.ts for modularity
  * 
  * REQUIREMENT: AudioWorklet is mandatory for this app to work correctly.
  * No fallback to MediaRecorder is provided.
  */
import { audioBufferToWav } from '../processing/audioBufferToWav';
import { calculatePeaksAsync } from '../processing/audioUtils';
import { perfLogger } from '../../utils/PerformanceLogger';

export interface RecordingConfig {
  rawRecordingMode: boolean;
  outputLatencyMs: number;
  baseLatencyMs: number;
  extraLatencyMs: number;
  bpm: number;
  timeSignature: [number, number];
  preRollMode: string;
  isPlaying: boolean;
  currentTime: number;
  headLength: number; // Rolling buffer head length
  startupDelayMs: number; // Estimated ms between onSetIsPlaying and actual playback start
  bufferSafetyMs: number; // Extra ms wait to ensure rolling buffer is populated
  audioContextRef: React.RefObject<AudioContext | null>;
  // AudioWorklet is mandatory - no useAudioWorklet option
}

export interface RecordingCallbacks {
  onSetIsPlaying: (playing: boolean) => void;
  onSetIsRecording: (recording: boolean) => void;
  onAddPhrase: (trackId: string, phrase: any) => void;
  onSeekTo: (time: number, allowNegative?: boolean) => void;
  getStoreState: () => any;
  onStartMetronome?: (nextBeatFrame: number, beatIndex: number, beatsPerBar: number, barTempo: Array<{bpm: number, framesPerBeat: number}>, barStartFrame: number) => void;
}

export class RecordingEngine {
  private config: RecordingConfig;
  private callbacks: RecordingCallbacks;

  // Recording state
  private continuousMicStream: MediaStream | null = null;
  private recordingCancelled = false;
  private activeTrackId: string | null = null;
  private punchInTime = 0;
  private punchInUserTime = 0; // User Time where user pressed Record (for clip startPos)
  private recordingStartTransportTime = 0;
  private expectedPreRoll = 0;
  private recordingSessionId = 0;

  // Idle timer: releases mic resources after 15s of inactivity
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  // Rolling buffer head length from config (defaults to 1s)
  private get headLength(): number {
    return this.config.headLength || 0.5;
  }

  // AudioWorklet recording (shared clock with playback)
  private audioWorkletNode: AudioWorkletNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private audioWorkletStartTime = 0;

  constructor(config: RecordingConfig, callbacks: RecordingCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    
    // Expose debug API on window
    if (typeof window !== 'undefined') {
      (window as any).__recordingDebug = {
        getState: () => ({
          activeTrackId: this.activeTrackId,
          recordingSessionId: this.recordingSessionId,
          isRecording: this.isRecording(),
          hasStream: !!this.continuousMicStream,
        }),
        start: (trackId: string) => this.startRecording(trackId),
        stop: () => this.stopRecording(),
        cancel: () => this.cancelRecording(),
        getConfig: () => this.config,
      };
      console.warn('RecordingEngine: Debug API available at window.__recordingDebug');
    }
  }

  async initializeForPlayback(): Promise<void> {
    this.cancelStopTimer();
    if (this.continuousMicStream) {
      console.warn('initializeForPlayback: already have stream, returning');
      return;
    }

    if (!this.config.rawRecordingMode) {
      this.continuousMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } else {
      const isChrome = /Chrome/.test(navigator.userAgent);
      let audio: MediaTrackConstraints;
      if (isChrome) {
        audio = {
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
        };
      } else {
        audio = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: this.config.audioContextRef?.current?.sampleRate,
        };
      }
      this.continuousMicStream = await navigator.mediaDevices.getUserMedia({ audio } as MediaStreamConstraints);
      const track = this.continuousMicStream.getAudioTracks()[0];
      console.log('RecordingEngine initializeForPlayback mic settings:', track?.getSettings());
    }

    await this.initAudioWorklet();
  }

  stopForPlayback(): void {
    this.cancelStopTimer();
    if (!this.continuousMicStream) {
      console.warn('stopForPlayback: no stream, returning');
      return;
    }

    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.close();
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.continuousMicStream) {
      this.continuousMicStream.getTracks().forEach(t => t.stop());
      this.continuousMicStream = null;
    }
  }

  scheduleStopPlayback(delay = 15000): void {
    this.cancelStopTimer();
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.stopForPlayback();
    }, delay);
  }

  cancelStopTimer(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  updateConfig(config: Partial<RecordingConfig>) {
    this.config = { ...this.config, ...config };
  }

  isRecording(): boolean {
    return this.audioWorkletNode !== null;
  }

  async initStream(): Promise<void> {
    this.cancelStopTimer();
    if (this.continuousMicStream) {
      this.continuousMicStream.getTracks().forEach(t => t.stop());
      this.continuousMicStream = null;
    }

    if (!this.config.rawRecordingMode) {
      this.continuousMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } else {
      const isChrome = /Chrome/.test(navigator.userAgent);
      let audio: any;
      if (isChrome) {
        audio = {
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
          googEchoCancellation: false,
          googAutoGainControl: false,
          googNoiseSuppression: false,
          googHighpassFilter: false,
          googTypingNoiseDetection: false,
        };
      } else {
        audio = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: this.config.audioContextRef?.current?.sampleRate,
        };
      }
      this.continuousMicStream = await navigator.mediaDevices.getUserMedia({ audio } as MediaStreamConstraints);
      const track2 = this.continuousMicStream.getAudioTracks()[0];
      console.log('RecordingEngine initStream mic settings:', track2?.getSettings());
    }

    await this.initAudioWorklet();
  }

  private async initAudioWorklet(): Promise<void> {
    const audioContext = this.config.audioContextRef?.current;
    if (!audioContext) {
      throw new Error('AudioWorklet init failed: AudioContext not available');
    }

    // AudioWorklet is mandatory - check support
    if (!audioContext.audioWorklet) {
      throw new Error(
        'AudioWorklet is not supported in this browser. ' +
        'Please use Chrome 64+, Firefox 79+, Safari 14.1+, or Edge 79+.'
      );
    }

    // FIXED: Resume AudioContext if suspended BEFORE creating AudioWorklet
    // Without this, currentTime doesn't advance and the worklet never starts
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    try {
      // Load the AudioWorklet processor
      // Guard against "module already registered" on second recording attempt
      try {
        await audioContext.audioWorklet.addModule('/worklets/recorder.worklet.js');
      } catch (moduleErr) {
        const msg = moduleErr instanceof Error ? moduleErr.message : String(moduleErr);
        if (!msg.includes('already been added')) {
          throw moduleErr;
        }
        console.warn('AudioWorklet: module already registered, reusing existing processor');
      }

      // Create MediaStreamAudioSourceNode to connect mic to AudioContext
      this.mediaStreamSource = audioContext.createMediaStreamSource(this.continuousMicStream!);

      // Create AudioWorkletNode with 1 output (needed to keep it active)
      this.audioWorkletNode = new AudioWorkletNode(audioContext, 'recorder-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 1, // Must have output to stay active in render graph
        channelCount: 1,
        processorOptions: {
          sampleRate: audioContext.sampleRate,
          headLength: this.headLength,
        }
      });

      // Handle messages from AudioWorklet
      this.audioWorkletNode.port.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'RECORDING_STARTED') {
          this.audioWorkletStartTime = data.startTime;
        } else if (data.type === 'RECORDING_STOPPED') {
          // If recording was cancelled, discard the data
          if (this.recordingCancelled) {
            this.recordingCancelled = false;
            this.activeTrackId = null;
            this.callbacks.onSetIsRecording(false);
          } else {
            // Pass audio data directly (no race condition)
            this.handleAudioWorkletStop(data.audioData, data.anchoredFrame, data.rollingOffset);
          }
        } else if (data.type === 'DEBUG') {
          console.log('AudioWorklet DEBUG:', data);
        }
      };

      // Connect mic source to AudioWorklet
      this.mediaStreamSource.connect(this.audioWorkletNode);
      
      // Connect to destination through silent gain node to keep worklet active
      // Without this, the worklet might not get process() calls
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0; // Silent
      this.audioWorkletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      console.log('AudioWorklet recording initialized');
    } catch (err) {
      console.error('AudioWorklet init failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to initialize AudioWorklet recording: ${errorMessage}. ` +
        'Please ensure you are using Chrome 64+, Firefox 79+, Safari 14.1+, or Edge 79+.'
      );
    }
  }

  // Handle AudioWorklet recording stop (shared clock with playback)
  private async handleAudioWorkletStop(audioData?: Float32Array, anchoredFrame?: number, rollingOffset?: number): Promise<void> {
    if (!audioData || audioData.length === 0) {
      console.warn('handleAudioWorkletStop: no data received');
      return;
    }

    const trackId = this.activeTrackId;
    if (!trackId) {
      console.warn('handleAudioWorkletStop: no trackId');
      return;
    }

    const audioContext = this.config.audioContextRef?.current;
    if (!audioContext) {
      console.error('handleAudioWorkletStop: AudioContext not available');
      return;
    }

    const sampleRate = audioContext.sampleRate;
    
    // NO trimming - keep all audio
    const finalAudioData = audioData;

    // Create AudioBuffer from Float32Array
    const totalLength = finalAudioData.length;
    const audioBuffer = audioContext.createBuffer(1, totalLength, sampleRate);
    audioBuffer.getChannelData(0).set(finalAudioData);
    
    // anchoredFrame is the AudioContext frame number where definitive recording starts
    // startPosition = UserTime where clip starts = punchInUserTime - headLength
    // This is direct and avoids drift from AudioContext-time-based anchorFrame
    const beatsPerSecond = (this.config.bpm || 120) / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const secondsPerBar = secondsPerBeat * (this.config.timeSignature?.[0] || 4);
    // HARDWARE COMPENSATION: Firefox + Linux audio pipeline adds ~230ms of
    // unaccounted playback delay beyond browser-reported outputLatency + baseLatency.
    // This covers PipeWire/PulseAudio/ALSA buffering not reflected in outputLatency.
    // Remove or adjust if a proper fix is found.
    const HW_COMP_MS = 230;
    const browserLatencyMs = (this.config.outputLatencyMs || 0) + (this.config.baseLatencyMs || 0);
    const latencyCompMs = browserLatencyMs + HW_COMP_MS + (this.config.extraLatencyMs || 0);
    const startPos = this.punchInUserTime - this.headLength - latencyCompMs / 1000;

    // Pre-calculate peaks
    let peaks: number[][] | undefined;
    try {
      peaks = await calculatePeaksAsync(audioBuffer);
    } catch (e) {
      console.warn('Failed to calculate peaks:', e);
    }

    // Convert to WAV
    const wavBlob = new Blob([audioBufferToWav(audioBuffer)], { type: 'audio/wav' });
    const finalAudioUrl = URL.createObjectURL(wavBlob);

    const anchoredFrameTime = anchoredFrame !== undefined ? anchoredFrame / sampleRate : 0;
    const ctxTimeNow = audioContext.currentTime;
    const clockDomainDelta = anchoredFrameTime - this.punchInUserTime;
    const workletFrameAge = ctxTimeNow - anchoredFrameTime;
    const beatDelta = clockDomainDelta / secondsPerBeat;
    console.log('RECORDING_DELTA', {
      punchInUserTime: this.punchInUserTime,
      punchInUserTime_Real: anchoredFrameTime,
      startPos,
      latencyCompMs,
      headLength: this.headLength,
      clockDomainDeltaSec: clockDomainDelta,
      clockDomainDeltaBeats: beatDelta,
      anchoredFrame,
      anchoredFrameAsTime: anchoredFrameTime,
      ctxTimeAtStop: ctxTimeNow,
      workletFrameAgeSec: workletFrameAge,
      secondsPerBar,
      secondsPerBeat,
    });
    perfLogger.log(24, trackId, startPos);
    this.callbacks.onAddPhrase(trackId, {
      url: finalAudioUrl,
      blob: wavBlob,
      audioBuffer: audioBuffer,
      peaks: peaks,
      startPosition: startPos,
      originalStartPosition: startPos,
      headLength: this.headLength,
      anchoredFrame: anchoredFrame,
      originalAnchoredFrame: anchoredFrame,
      duration: audioBuffer.duration,
      createdAt: Date.now()
    });

    perfLogger.log(25, this.recordingSessionId, 0);

    this.activeTrackId = null;
    this.callbacks.onSetIsRecording(false);
    this.scheduleStopPlayback();
  }

  async startRecording(trackId: string): Promise<void> {
    try {
      // Step 1: Calculate punchInUserTime (User Time)
      const storeState = this.callbacks.getStoreState();
      const isCurrentlyPlaying = this.config.isPlaying;
      
      const beatsPerSecond = this.config.bpm / 60;
      const secondsPerBeat = 1 / beatsPerSecond;
      const secondsPerBar = secondsPerBeat * this.config.timeSignature[0];
      
      let punchInUserTime: number;
      
      if (isCurrentlyPlaying) {
        // Playing: use store currentTime (multitrack playhead position)
        // NOT audioCtx.currentTime — that's the AudioContext wall clock
        // which diverges from the timeline the longer the AudioContext runs.
        punchInUserTime = Math.max(0, storeState?.currentTime || 0);
      } else {
        // Stopped: use store currentTime (playhead position)
        punchInUserTime = Math.max(0, storeState?.currentTime || 0);
      }

      const currentTime = punchInUserTime; // For compatibility with rest of function

      // Use storeTime for punchIn calculation
      // Increment session ID to invalidate any pending handleRecorderStop calls
      this.recordingSessionId++;
      const currentSessionId = this.recordingSessionId;
      perfLogger.log(18, trackId, currentSessionId);
      perfLogger.log(19, trackId, currentSessionId);

      // Ensure stream exists (will call initStream to initialize AudioWorklet)
      if (!this.continuousMicStream) {
        await this.initStream();
        perfLogger.log(20, this.recordingSessionId, 0);
      } else {
        this.cancelStopTimer();
      }

      const preRollMode = this.config.preRollMode;
      perfLogger.log(21, preRollMode, currentTime);

      // If already playing, force no count-in regardless of preRollMode setting
      const effectivePreRollMode = isCurrentlyPlaying ? 'none' : preRollMode;

      if (currentTime < 0) {
        alert("Cannot start recording during the pre-roll (before Bar 1).");
        return;
      }

      // Store punchInUserTime for clip startPos
      this.punchInUserTime = punchInUserTime;

      // Set activeTrackId early so stop handlers can reference it
      this.activeTrackId = trackId;

      // Named constants from config (Advanced / Dangerous Settings)
      const startupDelay = (this.config.startupDelayMs || 150) / 1000;
      const bufferSafety = (this.config.bufferSafetyMs || 100) / 1000;

      // For "none" + not playing: prime the buffer (wait for rolling buffer to accumulate head audio)
      if (!isCurrentlyPlaying && effectivePreRollMode === 'none') {
        const waitTime = this.headLength * 1000 + bufferSafety * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Calculate record start time (for seeking to pre-roll start)
      const recordStartUserTime = effectivePreRollMode !== 'none' ? punchInUserTime - secondsPerBar : punchInUserTime;

      // Seek to pre-roll start (allow negative user time for pre-roll)
      // Only seek if we are NOT already playing (to avoid interrupting playback)
      if (!isCurrentlyPlaying) {
        this.callbacks.onSeekTo(recordStartUserTime, true);
      }

      this.recordingStartTransportTime = recordStartUserTime;
      this.expectedPreRoll = effectivePreRollMode !== 'none' ? secondsPerBar : 0;
      this.punchInTime = performance.now();
this.recordingCancelled = false;

      // Coordinated start time for perfect sync
      const audioContext = this.config.audioContextRef?.current;
      if (!audioContext) throw new Error('AudioContext not initialized');

      if (!this.audioWorkletNode) {
        throw new Error('AudioWorklet not initialized. This should not happen.');
      }

      // Send START_RECORDING — worklet uses its own currentFrame as anchor
      // headLength sent per-recording so the worklet's head window matches the per-clip setting
      this.audioWorkletNode.port.postMessage({
        type: 'START_RECORDING',
        headLength: this.headLength,
      });

      // Sync metronome start to the same AudioContext timebase as the recording
      if (!isCurrentlyPlaying && this.callbacks.onStartMetronome) {
        const sr = audioContext.sampleRate;
        const beatDuration = 60 / (this.config.bpm || 120);
        const beatsPerBarVal = this.config.timeSignature?.[0] || 4;
        const secondsPerBarVal = beatDuration * beatsPerBarVal;

        const metStartTime = recordStartUserTime;
        const metRealTime = metStartTime + secondsPerBarVal;
        const nextBeatRealTime = Math.ceil(metRealTime / beatDuration) * beatDuration;
        const nextBeatProjectTime = nextBeatRealTime - secondsPerBarVal;
        const nextBeatCtxTime = audioContext.currentTime + startupDelay + (nextBeatProjectTime - metStartTime);
        const nextBeatFrame = Math.round(nextBeatCtxTime * sr);
        const totalBeats = Math.round(nextBeatRealTime / beatDuration);
        const beatIndex = totalBeats % beatsPerBarVal;
        const barIndex = Math.floor(totalBeats / beatsPerBarVal);
        const bar0ProjectTime = barIndex * beatsPerBarVal * beatDuration;
        const bar0CtxTime = nextBeatCtxTime - (nextBeatProjectTime - bar0ProjectTime);
        const barStartFrame = Math.round(bar0CtxTime * sr);
        const framesPerBeat = Math.round(sr * beatDuration);
        const barTempo = [{ bpm: this.config.bpm || 120, framesPerBeat }];

        this.callbacks.onStartMetronome(nextBeatFrame, beatIndex, beatsPerBarVal, barTempo, barStartFrame);
      }

      const recorderStartCtxTime = audioContext.currentTime;
      const playbackStartCtxTime = recorderStartCtxTime + startupDelay;
      const startDelay = playbackStartCtxTime - recorderStartCtxTime;

      // Store the expected pre-roll duration (1 bar + the start delay)
      this.expectedPreRoll = (effectivePreRollMode !== 'none' ? secondsPerBar : 0) + startDelay;

      // Start Playback
      this.callbacks.onSetIsPlaying(true);
      this.callbacks.onSetIsRecording(true);
      
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
      this.callbacks.onSetIsRecording(false);
      perfLogger.log(25, this.recordingSessionId, 0);
    }
  }

  stopRecording(): void {
    console.log('stopRecording: called', new Error().stack);
    
    if (!this.audioWorkletNode) {
      console.warn('stopRecording: AudioWorklet not initialized');
      return;
    }
    
    // AudioWorklet: send STOP_RECORDING message
    console.log('AudioWorklet: posting STOP_RECORDING message');
    this.audioWorkletNode.port.postMessage({ type: 'STOP_RECORDING' });
  }

  cancelRecording(): void {
    console.log('cancelRecording: called', new Error().stack);
    this.recordingCancelled = true;
    
    if (this.audioWorkletNode) {
      // AudioWorklet: send STOP_RECORDING message to discard data
      this.audioWorkletNode.port.postMessage({ type: 'STOP_RECORDING' });
    }
    this.callbacks.onSetIsRecording(false);
  }

  cleanup(): void {
    this.cancelStopTimer();
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.close();
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.continuousMicStream) {
      this.continuousMicStream.getTracks().forEach(t => t.stop());
      this.continuousMicStream = null;
    }

    this.activeTrackId = null;
  }
}