/**
 * RecordingEngine - Encapsulates all recording logic
 * Extracted from useAudioEngine.ts for modularity
 */
import { audioBufferToWav } from '../processing/audioBufferToWav';
import { calculatePeaksAsync } from '../processing/audioUtils';

export interface RecordingConfig {
  rawRecordingMode: boolean;
  globalLatencyMs: number;
  extraLatencyMs: number;
  bpm: number;
  timeSignature: [number, number];
  preRollMode: string;
  isPlaying: boolean;
  currentTime: number;
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
  private recordingStartTransportTime = 0;
  private expectedPreRoll = 0;
  private audioContext: AudioContext | null = null;

  constructor(config: RecordingConfig, callbacks: RecordingCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  updateConfig(config: Partial<RecordingConfig>) {
    this.config = { ...this.config, ...config };
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
    this.startContinuousRecorder();
  }

  private startContinuousRecorder(): void {
    if (!this.continuousMicStream) return;

    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
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

    mediaRecorder.onstop = async () => {
      await this.handleRecorderStop();
    };

    this.recorderStartTime = performance.now();
    mediaRecorder.start(100);
  }

  private async handleRecorderStop(): Promise<void> {
    const storeState = this.callbacks.getStoreState();

    // We only process if we were actually recording
    if (!storeState.isRecording && !this.activeTrackId) {
      this.startContinuousRecorder();
      return;
    }

    if (this.recordingCancelled) {
      this.audioChunks = [];
      this.activeTrackId = null;
      this.startContinuousRecorder();
      return;
    }

    const trackId = this.activeTrackId;
    this.activeTrackId = null;

    if (!trackId) return;

    const audioBlob = new Blob(this.audioChunks, { type: this.continuousRecorder?.mimeType || 'audio/webm' });
    const audioUrl = URL.createObjectURL(audioBlob);

    const latencyMs = this.config.globalLatencyMs + this.config.extraLatencyMs;
    const latencySec = latencyMs / 1000;

    // Calculate how much to trim from the beginning of the continuous recording
    const punchInOffsetSec = (this.punchInTime - this.recorderStartTime) / 1000;

    let actualTrimSec = 0;
    let startPos = 0;

    if (this.expectedPreRoll > 0) {
      // We had a count-in. We don't need the circular buffer from before the count-in.
      const keepPreRollSec = 0.5;
      actualTrimSec = punchInOffsetSec + Math.max(0, this.expectedPreRoll - keepPreRollSec);
      startPos = this.recordingStartTransportTime + Math.max(0, this.expectedPreRoll - keepPreRollSec) - latencySec;
    } else {
      // No count-in (punch-in during playback). We use the circular buffer.
      const keepPreRollSec = 1.5;
      actualTrimSec = Math.max(0, punchInOffsetSec - keepPreRollSec);
      startPos = this.recordingStartTransportTime - (punchInOffsetSec - actualTrimSec) - latencySec;
    }

    console.log('onstop', { 
      expectedPreRoll: this.expectedPreRoll, 
      latencyMs, 
      latencySec, 
      startPos, 
      actualTrimSec, 
      punchInOffsetSec 
    });

    let finalAudioBuffer: AudioBuffer | undefined;
    let finalAudioUrl = audioUrl;
    let finalAudioBlob = audioBlob;
    let peaks: number[][] | undefined;

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const originalBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));

      // Destructively trim the pre-roll
      const sampleRate = originalBuffer.sampleRate;
      const startSample = Math.floor(actualTrimSec * sampleRate);
      const endSample = originalBuffer.length;
      const newLength = Math.max(1, endSample - startSample);

      const trimmedBuffer = this.audioContext.createBuffer(
        originalBuffer.numberOfChannels,
        newLength,
        sampleRate
      );

      for (let channel = 0; channel < originalBuffer.numberOfChannels; channel++) {
        const originalData = originalBuffer.getChannelData(channel);
        const trimmedData = trimmedBuffer.getChannelData(channel);
        for (let i = 0; i < newLength; i++) {
          trimmedData[i] = originalData[startSample + i] || 0;
        }
      }

      finalAudioBuffer = trimmedBuffer;

      // Pre-calculate peaks to avoid main-thread spikes during WaveSurfer init
      peaks = await calculatePeaksAsync(trimmedBuffer);

      // Convert trimmed buffer back to WAV blob
      const trimmedWav = audioBufferToWav(trimmedBuffer);
      finalAudioBlob = new Blob([trimmedWav], { type: 'audio/wav' });
      finalAudioUrl = URL.createObjectURL(finalAudioBlob);

    } catch (e) {
      console.error("Failed to decode and trim recorded audio", e);
    }

    this.callbacks.onAddPhrase(trackId, {
      url: finalAudioUrl,
      blob: finalAudioBlob,
      audioBuffer: finalAudioBuffer,
      peaks: peaks,
      startPosition: startPos,
      duration: finalAudioBuffer ? finalAudioBuffer.duration : 0.1,
      createdAt: Date.now()
    });

    // Instantly restart the continuous recorder for the next recording
    this.startContinuousRecorder();
  }

  async startRecording(trackId: string): Promise<void> {
    try {
      // Resume AudioContext on user gesture if needed
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (!this.continuousMicStream) {
        await this.initStream();
      }

      this.activeTrackId = trackId;

      const isCurrentlyPlaying = this.config.isPlaying;
      const preRollMode = this.config.preRollMode;

      // If already playing, force no count-in regardless of preRollMode setting
      const effectivePreRollMode = isCurrentlyPlaying ? 'none' : preRollMode;

      if (this.config.currentTime < 0) {
        alert("Cannot start recording during the pre-roll (before Bar 1).");
        return;
      }

      // Prevent punching in during the pre-roll (Bar 0)
      const punchInUserTime = Math.max(0, this.config.currentTime);

      const beatsPerSecond = this.config.bpm / 60;
      const secondsPerBeat = 1 / beatsPerSecond;
      const secondsPerBar = secondsPerBeat * this.config.timeSignature[0];

      // Recording starts 1 bar before punch-in if count-in is enabled
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
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const recorderStartCtxTime = this.audioContext.currentTime;
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
    }
  }

  stopRecording(): void {
    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      this.continuousRecorder.stop();
    }
    this.callbacks.onSetIsRecording(false);
  }

  cancelRecording(): void {
    this.recordingCancelled = true;
    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      this.continuousRecorder.stop();
    }
    this.callbacks.onSetIsRecording(false);
  }

  cleanup(): void {
    if (this.continuousRecorder && this.continuousRecorder.state !== 'inactive') {
      this.continuousRecorder.stop();
    }
    this.continuousRecorder = null;

    if (this.continuousMicStream) {
      this.continuousMicStream.getTracks().forEach(t => t.stop());
      this.continuousMicStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioChunks = [];
    this.activeTrackId = null;
  }
}
