/**
 * RecordingEngine - Encapsulates all recording logic
 * Extracted from useAudioEngine.ts for modularity
 */
import { audioBufferToWav } from '../processing/audioBufferToWav';
import { calculatePeaksAsync } from '../processing/audioUtils';
import { perfLogger } from '../../utils/PerformanceLogger';

export interface RecordingConfig {
  rawRecordingMode: boolean;
  globalLatencyMs: number;
  extraLatencyMs: number;
  bpm: number;
  timeSignature: [number, number];
  preRollMode: string;
  isPlaying: boolean;
  currentTime: number;
  audioContextRef: React.RefObject<AudioContext | null>;
  useAudioWorklet?: boolean; // Use AudioWorklet for recording (shared clock with playback)
}

export interface RecordingCallbacks {
  onSetIsPlaying: (playing: boolean) => void;
  onSetIsRecording: (recording: boolean) => void;
  onAddPhrase: (trackId: string, phrase: any) => void;
  onSeekTo: (time: number, allowNegative?: boolean) => void;
  getStoreState: () => any;
}

export class RecordingEngine {
  private config: RecordingConfig;
  private callbacks: RecordingCallbacks;

  // Recording state
  private continuousMicStream: MediaStream | null = null;
  private continuousRecorder: MediaRecorder | null = null;
  private recordingCancelled = false;
  private audioChunks: Blob[] = [];
  private activeTrackId: string | null = null;
  private recorderStartTime = 0;
  private punchInTime = 0;
  private punchInUserTime = 0; // User Time where user pressed Record (for clip startPos)
  private recordingStartTransportTime = 0;
  private expectedPreRoll = 0;
  private recordingSessionId = 0;

  // AudioWorklet recording (shared clock with playback)
  private audioWorkletNode: AudioWorkletNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private useAudioWorklet = false;
  private audioWorkletStartTime = 0;

  constructor(config: RecordingConfig, callbacks: RecordingCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.useAudioWorklet = config.useAudioWorklet ?? false;
    
    // Expose debug API on window
    if (typeof window !== 'undefined') {
      (window as any).__recordingDebug = {
        getState: () => ({
          activeTrackId: this.activeTrackId,
          recordingSessionId: this.recordingSessionId,
          isRecording: this.isRecording(),
          recorderState: this.continuousRecorder?.state,
          hasStream: !!this.continuousMicStream,
          useAudioWorklet: this.useAudioWorklet,
        }),
        start: (trackId: string) => this.startRecording(trackId),
        stop: () => this.stopRecording(),
        cancel: () => this.cancelRecording(),
        getConfig: () => this.config,
        getChunksLength: () => this.audioChunks.length,
      };
      console.log('RecordingEngine: Debug API available at window.__recordingDebug');
    }
  }

  updateConfig(config: Partial<RecordingConfig>) {
    this.config = { ...this.config, ...config };
    if (config.useAudioWorklet !== undefined) {
      this.useAudioWorklet = config.useAudioWorklet;
    }
  }

  isRecording(): boolean {
    return this.continuousRecorder !== null && this.continuousRecorder.state !== 'inactive';
  }

  async initStream(): Promise<void> {
    if (this.continuousMicStream) {
      this.continuousMicStream.getTracks().forEach(t => t.stop());
      this.continuousMicStream = null;
    }

    const constraints: MediaStreamConstraints = this.config.rawRecordingMode
      ? {
            audio: {
              echoCancellation: { exact: false },
              noiseSuppression: { exact: false },
              autoGainControl: { exact: false },
              // @ts-ignore - Chrome specific constraints
              googEchoCancellation: false,
              googAutoGainControl: false,
              googNoiseSuppression: false,
              googHighpassFilter: false,
              googTypingNoiseDetection: false,
            }
          }
      : { audio: true };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.continuousMicStream = stream;

    if (this.useAudioWorklet) {
      await this.initAudioWorklet();
    } else {
      // Start continuous recording immediately (as user explained)
      this.startContinuousRecorder();
    }
  }

  private async initAudioWorklet(): Promise<void> {
    const audioContext = this.config.audioContextRef?.current;
    if (!audioContext) {
      console.error('AudioWorklet init failed: AudioContext not available');
      this.useAudioWorklet = false; // Fallback to MediaRecorder
      this.startContinuousRecorder();
      return;
    }

    try {
      // Load the AudioWorklet processor
      await audioContext.audioWorklet.addModule('/worklets/recorder.worklet.js');

      // Create MediaStreamAudioSourceNode to connect mic to AudioContext
      this.mediaStreamSource = audioContext.createMediaStreamSource(this.continuousMicStream!);

      // Create AudioWorkletNode with 1 output (needed to keep it active)
      this.audioWorkletNode = new AudioWorkletNode(audioContext, 'recorder-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 1, // Must have output to stay active in render graph
        channelCount: 1,
        processorOptions: {
          sampleRate: audioContext.sampleRate,
        }
      });

      // Handle messages from AudioWorklet
      this.audioWorkletNode.port.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'RECORDING_STARTED') {
          console.log('AudioWorklet: Recording started at', data.startTime, 'contextTime:', data.currentTime);
          this.audioWorkletStartTime = data.startTime;
        } else if (data.type === 'RECORDING_STOPPED') {
          console.log('AudioWorklet: Recording stopped at', data.stopTime);
          // Pass audio data directly (no race condition)
          this.handleAudioWorkletStop(data.audioData, data.recordingStartTime);
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
      console.error('AudioWorklet init failed, falling back to MediaRecorder:', err);
      this.useAudioWorklet = false;
      this.startContinuousRecorder();
    }
  }

  private startContinuousRecorder(): void {
    if (!this.continuousMicStream) {
      console.log('startContinuousRecorder: no stream, returning');
      return;
    }

    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      console.log('startContinuousRecorder: stopping existing recorder');
      this.continuousRecorder.stop();
    }

    this.audioChunks = [];

    // Determine MIME type with fallback
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm';

    const mediaRecorder = new MediaRecorder(this.continuousMicStream, { mimeType });
    this.continuousRecorder = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.audioChunks.push(e.data);
      }
    };

    // Add error handler to catch recorder errors
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder ERROR:', event);
    };

    // DON'T set onstop here - will be set in startRecording()
    // This prevents stale sessionId capture during initStream()

    this.recorderStartTime = performance.now();
    console.log('startContinuousRecorder: starting recorder with timeslice=100');
    mediaRecorder.start(100);
  }

  private async handleRecorderStop(sessionId: number, capturedTrackId: string | null): Promise<void> {
    // Check if this is a stale session FIRST (before any other logic)
    if (sessionId !== this.recordingSessionId) {
      console.log('handleRecorderStop: STALE session detected!', { sessionId, currentSessionId: this.recordingSessionId, capturedTrackId });
      perfLogger.log(23, sessionId, this.recordingSessionId);
      return; // Exit immediately - don't process stale sessions
    }
    
    const storeState = this.callbacks.getStoreState();
    
    console.log('handleRecorderStop: entry', { sessionId, capturedTrackId, thisActiveTrackId: this.activeTrackId });
    console.log('handleRecorderStop: call stack', new Error().stack);
    
    // If this fires too quickly (within 1 second of start), log warning
    const timeSinceStart = performance.now() - this.recorderStartTime;
    if (timeSinceStart < 1000) {
      console.warn('handleRecorderStop fired suspiciously fast!', { timeSinceStart, sessionId, capturedTrackId });
      // Don't debugger - we already have the stale check above
    }
    
    console.log('handleRecorderStop: CURRENT session, proceeding', { sessionId, capturedTrackId });
    
    // Use the captured trackId (not this.activeTrackId which might have been overwritten)
    const trackId = capturedTrackId;
    
    if (!trackId) {
      console.log('handleRecorderStop: no trackId, returning');
      return;
    }
    
    console.log('handleRecorderStop: CURRENT session, proceeding', { sessionId, trackId });
    
    // If we get here, it's the current session
    this.activeTrackId = null;
    
    const audioBlob = new Blob(this.audioChunks, { type: this.continuousRecorder?.mimeType || 'audio/webm' });
    const audioUrl = URL.createObjectURL(audioBlob);
    console.log('handleRecorderStop: audioBlob created', { size: audioBlob.size, type: audioBlob.type });

    // NO trimming - keep all audio data
    // Calculate audioOffset: skip pre-roll + recHeadstart + latencies (for playback sync)
    // Pre-roll audio might be in buffer if AudioWorklet started too early
    const outputLatencySec = this.config.audioContextRef?.current?.outputLatency || 0.025; // Default 25ms
    const headDuration = 1.0; // The recHeadstart we captured
    const inputLatencySec = this.config.globalLatencyMs / 1000; // Input latency compensation
    
    // Pre-roll duration: if pre-roll was active when recording started
    const preRollDuration = (this.config.preRollMode !== 'none' && !this.config.isPlaying) 
      ? (60 / this.config.bpm) * this.config.timeSignature[0] 
      : 0;
    
    // audioOffset = -(pre-roll + recHeadstart + output latency + input latency)
    const audioOffset = -(preRollDuration + headDuration + outputLatencySec + inputLatencySec);
    
    console.log('handleAudioWorkletStop: audioOffset breakdown:', {
      preRollDuration,
      headDuration,
      outputLatencySec,
      inputLatencySec,
      total: audioOffset
    });
    
    // FIXED: startPos = punchInUserTime (correct visual position)
    const startPos = this.punchInUserTime;

    // Decode audio without trimming
    let finalAudioBuffer: AudioBuffer | undefined;
    let finalAudioUrl = audioUrl;
    let finalAudioBlob = audioBlob;
    let peaks: number[][] | undefined;

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = this.config.audioContextRef?.current;
      if (!audioContext) throw new Error('AudioContext not initialized');
      const originalBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      finalAudioBuffer = originalBuffer;

      // Pre-calculate peaks
      peaks = await calculatePeaksAsync(originalBuffer);

      // Convert to WAV
      const wavBlob = new Blob([audioBufferToWav(originalBuffer)], { type: 'audio/wav' });
      finalAudioBlob = wavBlob;
      finalAudioUrl = URL.createObjectURL(wavBlob);

    } catch (e) {
      console.error("Failed to decode recorded audio", e);
    }

    console.log('handleRecorderStop: creating phrase', { trackId, startPos, duration: finalAudioBuffer ? finalAudioBuffer.duration : 0.1 });
    perfLogger.log(24, trackId, startPos);
    this.callbacks.onAddPhrase(trackId, {
      url: finalAudioUrl,
      blob: finalAudioBlob,
      audioBuffer: finalAudioBuffer,
      peaks: peaks,
      startPosition: startPos, // CORRECT visual position
      audioOffset: audioOffset, // NEW: Skip head + compensate latency
      duration: finalAudioBuffer ? finalAudioBuffer.duration : 0.1,
      createdAt: Date.now()
    });
    console.log('handleRecorderStop: phrase created, setting isRecording to false');
    
    this.callbacks.onSetIsRecording(false);
    perfLogger.log(25, this.recordingSessionId, 0);

    // Instantly restart the continuous recorder for the next recording
    this.startContinuousRecorder();
  }

  // Handle AudioWorklet recording stop (shared clock with playback)
  private async handleAudioWorkletStop(audioData?: Float32Array, recordingStartTime?: number): Promise<void> {
    if (!audioData || audioData.length === 0) {
      console.warn('handleAudioWorkletStop: no data received');
      return;
    }

    const trackId = this.activeTrackId;
    if (!trackId) {
      console.log('handleAudioWorkletStop: no trackId');
      return;
    }

    const audioContext = this.config.audioContextRef?.current;
    if (!audioContext) {
      console.error('handleAudioWorkletStop: AudioContext not available');
      return;
    }

    const sampleRate = audioContext.sampleRate;
    
    // NO trimming - keep all audio (including 1s pre-roll for offset/fade-in)
    const finalAudioData = audioData;

    // Create AudioBuffer from Float32Array
    const totalLength = finalAudioData.length;
    const audioBuffer = audioContext.createBuffer(1, totalLength, sampleRate);
    audioBuffer.getChannelData(0).set(finalAudioData);
    
    // Calculate audioOffset: skip pre-roll + recHeadstart + latencies (for playback sync)
    const outputLatencySec = this.config.audioContextRef?.current?.outputLatency || 0.025;
    const headDuration = 1.0;
    const inputLatencySec = this.config.globalLatencyMs / 1000;
    const preRollDuration = (this.config.preRollMode !== 'none' && !this.config.isPlaying) 
      ? (60 / this.config.bpm) * this.config.timeSignature[0] 
      : 0;
    
    const audioOffset = -(preRollDuration + headDuration + outputLatencySec + inputLatencySec);
    
    console.log('handleAudioWorkletStop: audioOffset breakdown:', {
      preRollDuration,
      headDuration,
      outputLatencySec,
      inputLatencySec,
      total: audioOffset
    });
    
    // FIXED: startPos = punchInUserTime (correct visual position)
    const startPos = this.punchInUserTime;

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

    console.log('handleAudioWorkletStop: creating phrase (shared clock)', {
      trackId,
      startPos,
      duration: audioBuffer.duration,
      originalStartTransportTime: this.recordingStartTransportTime,
    });

    perfLogger.log(24, trackId, startPos);
    this.callbacks.onAddPhrase(trackId, {
      url: finalAudioUrl,
      blob: wavBlob,
      audioBuffer: audioBuffer,
      peaks: peaks,
      startPosition: startPos, // CORRECT visual position
      audioOffset: audioOffset, // NEW: Skip head + compensate latency during playback
      duration: audioBuffer.duration,
      createdAt: Date.now()
    });

    console.log('handleAudioWorkletStop: phrase created, setting isRecording to false');
    this.callbacks.onSetIsRecording(false);
    perfLogger.log(25, this.recordingSessionId, 0);

    this.activeTrackId = null;
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
        // Playing: AudioContext.currentTime is accurate (aligned with scrolling)
        const audioCtx = this.config.audioContextRef?.current;
        const currentTimeReal = audioCtx?.currentTime || 0;
        punchInUserTime = Math.max(0, currentTimeReal - secondsPerBar);
      } else {
        // Stopped: use store currentTime (playhead position)
        punchInUserTime = Math.max(0, storeState?.currentTime || 0);
      }
      
      const currentTime = punchInUserTime; // For compatibility with rest of function
      
      console.log('startRecording: entry', { 
        trackId, 
        punchInUserTime,
        isCurrentlyPlaying,
        storeTime: storeState?.currentTime
      });
      
      // Use storeTime for punchIn calculation
      // Increment session ID to invalidate any pending handleRecorderStop calls
      this.recordingSessionId++;
      const currentSessionId = this.recordingSessionId;
      perfLogger.log(18, trackId, currentSessionId);
      console.log('startRecording: sessionId =', currentSessionId);
      
      // Set activeTrackId FIRST before any async operations
      this.activeTrackId = trackId;
      perfLogger.log(19, trackId, currentSessionId);
      console.log('startRecording: activeTrackId set', trackId);
      
      // Ensure stream exists (will call initStream which starts continuous recording)
      if (!this.continuousMicStream) {
        console.log('startRecording: calling initStream to create stream + start continuous recording');
        await this.initStream();  // initStream starts the continuous recorder
        perfLogger.log(20, this.recordingSessionId, 0);
        console.log('startRecording: initStream complete, continuous recorder running');
      }
      
      const preRollMode = this.config.preRollMode;
      
      console.log('startRecording', { preRollMode, isCurrentlyPlaying, currentTime });
      perfLogger.log(21, preRollMode, currentTime);
      
      // If already playing, force no count-in regardless of preRollMode setting
      const effectivePreRollMode = isCurrentlyPlaying ? 'none' : preRollMode;
      
      if (currentTime < 0) {
        alert("Cannot start recording during the pre-roll (before Bar 1).");
        return;
      }
      
      // Store punchInUserTime for clip startPos
      this.punchInUserTime = punchInUserTime;
      console.log('startRecording: punchInUserTime captured', { 
        punchInUserTime: this.punchInUserTime
      });
      
      // For "none" + not playing: prime the buffer (wait 1s for 2s rolling buffer to fill)
      if (!isCurrentlyPlaying && effectivePreRollMode === 'none' && this.useAudioWorklet) {
        console.log('startRecording: priming buffer for "none" + not playing (waiting 1s)');
        await new Promise(resolve => setTimeout(resolve, 1000));
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
      
      // Set recording mode FIRST so engine knows to allow negative seeks/scrolls
      // This would need to be passed via callbacks if multitrack needs it
      
      // Coordinated start time for perfect sync
      const audioContext = this.config.audioContextRef?.current;
      if (!audioContext) throw new Error('AudioContext not initialized');
      
      // FIXED: Calculate punchInUserTime_Real NOW (just before playback starts)
      // This ensures audioContext.currentTime is accurate
      let punchInUserTime_Real: number;
      
      if (isCurrentlyPlaying) {
        // Playing: currentTime IS the Real Time
        punchInUserTime_Real = audioContext.currentTime;
      } else {
        // Stopped: Playback will start after a short delay (seek + onSetIsPlaying)
        const startupDelay = 0.15; // Approximate delay until playback starts
        const timeFromPlaybackStartToPunchIn = punchInUserTime - recordStartUserTime;
        // punchInUserTime_Real = when punch-in will occur in AudioContext time
        punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn;
      }
      
      console.log('startRecording: punchInUserTime_Real calculated', {
        punchInUserTime_Real,
        audioCtxTime: audioContext.currentTime,
        timeFromPlaybackStartToPunchIn: punchInUserTime - recordStartUserTime,
        isCurrentlyPlaying
      });
      
      if (this.useAudioWorklet) {
        // AudioWorklet: send START_RECORDING with punchInUserTime_Real
        // AudioWorklet will start recording 1s before punchInUserTime (recHeadstart)
        // Let AudioWorklet decide when to start using its own currentTime
        console.log('startRecording: using AudioWorklet (shared clock)');
        if (this.audioWorkletNode) {
          this.audioWorkletNode.port.postMessage({ 
            type: 'START_RECORDING',
            punchInUserTime_Real: punchInUserTime_Real
          });
          console.log('AudioWorklet: posted START_RECORDING with punchInUserTime_Real', punchInUserTime_Real);
        }
      } else {
        // MediaRecorder: stop old recorder to recycle buffer
        console.log('startRecording: stopping continuous recorder to recycle buffer');
        if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
          // Clear any old onstop handler to prevent stale calls
          this.continuousRecorder.onstop = null;
          this.continuousRecorder.stop();  // This fires onstop → but handler is null, so nothing happens
        }
        
        // NOW set up the onstop handler for the NEW recorder with current sessionId
        const sessionId = currentSessionId;  // Capture current sessionId
        const trackId = this.activeTrackId;
        if (this.continuousRecorder) {
          this.continuousRecorder.onstop = () => {
            console.log('onstop handler: calling handleRecorderStop with sessionId=' + sessionId + ', trackId=' + trackId);
            this.handleRecorderStop(sessionId, trackId);
          };
        }
         
        // Immediately restart with fresh recorder for this recording session
        console.log('startRecording: restarting continuous recorder for new session', currentSessionId);
        this.startContinuousRecorder();  // Creates new recorder (onstop set above will fire when this new one stops)
      }
      
      const recorderStartCtxTime = audioContext.currentTime;
      const playbackStartCtxTime = recorderStartCtxTime + 0.15;
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
    
    if (this.useAudioWorklet && this.audioWorkletNode) {
      // AudioWorklet: send STOP_RECORDING message (more reliable than parameter)
      console.log('AudioWorklet: posting STOP_RECORDING message');
      this.audioWorkletNode.port.postMessage({ type: 'STOP_RECORDING' });
    } else {
      // MediaRecorder: stop the recorder
      console.log('stopRecording: recorder state =', this.continuousRecorder?.state);
      if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
        console.log('stopRecording: stopping recorder');
        this.continuousRecorder.stop();
      }
    }
    // onSetIsRecording(false) is now called in handleRecorderStop after phrase creation
  }

  cancelRecording(): void {
    console.log('cancelRecording: called', new Error().stack);
    this.recordingCancelled = true;
    
    if (this.useAudioWorklet && this.audioWorkletNode) {
      // AudioWorklet: send STOP_RECORDING message to discard data
      this.audioWorkletNode.port.postMessage({ type: 'STOP_RECORDING' });
    } else if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      console.log('cancelRecording: stopping recorder');
      this.continuousRecorder.stop();
    }
    this.callbacks.onSetIsRecording(false);
  }

  cleanup(): void {
    if (this.useAudioWorklet) {
      // Cleanup AudioWorklet resources
      if (this.audioWorkletNode) {
        this.audioWorkletNode.port.close();
        this.audioWorkletNode.disconnect();
        this.audioWorkletNode = null;
      }
      if (this.mediaStreamSource) {
        this.mediaStreamSource.disconnect();
        this.mediaStreamSource = null;
      }
    } else {
      if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
        this.continuousRecorder.stop();
      }
      this.continuousRecorder = null;
    }

    if (this.continuousMicStream) {
      this.continuousMicStream.getTracks().forEach(t => t.stop());
      this.continuousMicStream = null;
    }

    // AudioContext is managed by useAudioEngine, not here

    this.audioChunks = [];
    this.activeTrackId = null;
  }
}
