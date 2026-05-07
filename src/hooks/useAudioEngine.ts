import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import MultiTrack, { type TrackOptions } from '../lib/multitrack/multitrack';
import WebAudioPlayer from '../lib/multitrack/webaudio';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { useStore } from '../store/useStore';
import { audioBufferToWav } from '../audio/processing/audioBufferToWav';
import { calculatePeaksAsync } from '../audio/processing/audioUtils';
import { RecordingEngine, RecordingConfig, RecordingCallbacks } from '../audio/recording/RecordingEngine';
import { MetronomeEngine } from '../audio/metronome/MetronomeEngine';
import { perfLogger } from '../utils/PerformanceLogger';

// Override WaveSurfer.prototype.load to catch unhandled promise rejections globally
const originalLoad = WaveSurfer.prototype.load;
WaveSurfer.prototype.load = function(this: WaveSurfer, ...args: unknown[]) {
  const promise = (originalLoad as (...args: unknown[]) => Promise<void>).apply(this, args);
  if (promise && typeof promise.catch === 'function') {
    promise.catch((e: Error) => {
      if (e && e.name === 'AbortError') return;
      console.warn("WaveSurfer load error:", e);
    });
  }
  return promise;
};

// Override WaveSurfer.prototype.play to catch unhandled promise rejections globally
const originalPlay = WaveSurfer.prototype.play;
WaveSurfer.prototype.play = function(this: WaveSurfer, ...args: unknown[]) {
  const promise = (originalPlay as (...args: unknown[]) => Promise<void>).apply(this, args);
  if (promise && typeof promise.catch === 'function') {
    promise.catch((e: Error) => {
      if (e && e.name === 'AbortError') return;
      if (e && e.message && e.message.includes('aborted by the user agent')) return;
      console.warn("WaveSurfer play error:", e);
    });
  }
  return promise;
};

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function useAudioEngine() {
  const rawRecordingMode = useStore(state => state.rawRecordingMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const multitrackRef = useRef<MultiTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const metronomeBufferRef = useRef<{bpm: number, timeSignature: [number, number], buffer: AudioBuffer} | null>(null);
  const isPreRollingRef = useRef(false);
  const [multitrack, setMultitrack] = useState<MultiTrack | null>(null);
  
  // Engine refs for modular audio architecture
  const metronomeEngineRef = useRef<MetronomeEngine | null>(null);
  const recordingEngineRef = useRef<RecordingEngine | null>(null);
  // Dummy state to force a retry when AudioContext becomes available
  // AudioContext initialization & retry mechanism
const { 
  tracks, 
  zoom, 
  isPlaying,
  isRecording,
  selectedTrackId,
  selectedPhraseId,
  envelopeLocked,
  waveformQuality,
  bpm,
  timeSignature,
  preRollMode,
  currentTime,
  globalLatencyMs,
  extraLatencyMs,
  duration,
  setIsPlaying,
  setIsRecording,
  setCurrentTime,
  setDuration,
  moveLocked,
  isReady,
  setIsReady,
  trackHeight,
  metronomeHeight
} = useStore();

  const beatsPerSecond = (bpm || 120) / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const secondsPerBar = secondsPerBeat * (timeSignature?.[0] || 4);

   
   // Initialize and update audio engines
  useEffect(() => {
    // Initialize MetronomeEngine when audioContext is available
    if (audioContextRef.current && !metronomeEngineRef.current) {
      metronomeEngineRef.current = new MetronomeEngine(audioContextRef.current);
    }

    // Initialize RecordingEngine
    // Detect AudioWorklet support
    const audioContext = audioContextRef.current;
    const useAudioWorklet = audioContext?.audioWorklet !== undefined;

    if (!recordingEngineRef.current) {
      const config: RecordingConfig = {
        rawRecordingMode,
        globalLatencyMs: globalLatencyMs || 0,
        extraLatencyMs: extraLatencyMs || 0,
        bpm: bpm || 120,
        timeSignature: timeSignature || [4, 4],
        preRollMode,
        isPlaying,
        currentTime,
        audioContextRef,
        useAudioWorklet,
      };

      const callbacks: RecordingCallbacks = {
        onSetIsPlaying: (playing) => {
          console.log('callback: setIsPlaying', playing);
          setIsPlaying(playing);
        },
        onSetIsRecording: (recording) => {
          console.log('callback: setIsRecording', recording);
          setIsRecording(recording);
        },
        onAddPhrase: (trackId, phrase) => {
          console.log('callback: onAddPhrase', { trackId, startPosition: phrase.startPosition, duration: phrase.duration, audioOffset: phrase.audioOffset });
          useStore.getState().addPhrase(trackId, phrase);
          // DIRECT: Also update multitrack immediately so it gets the audioOffset
          const track = useStore.getState().tracks.find(t => t.id === trackId);
          if (track && multitrackRef.current && phrase.audioOffset !== undefined) {
            console.log('useAudioEngine: DIRECT update multitrack track', trackId, 'with audioOffset=', phrase.audioOffset);
            // Update track.audioOffset
            track.audioOffset = phrase.audioOffset;
            // Convert Track to TrackOptions (multitrack expects this)
            const trackOptions = {
              id: track.id,
              name: track.name,
              color: track.color,
              isMuted: track.isMuted,
              isSolo: track.isSolo,
              volume: track.volume,
              pan: track.pan,
              offset: track.offset,
              audioOffset: track.audioOffset,
              phrases: track.phrases.map(p => ({
                url: p.url,
                audioBuffer: p.audioBuffer,
                peaks: p.peaks,
                startPosition: p.startPosition,
                duration: p.duration,
                audioOffset: p.audioOffset,
              })),
            } as any;
            multitrackRef.current.addTrack(trackOptions);
          }
        },
        onSeekTo: (time, allowNegative) => {
          console.log('callback: seekTo', { time, allowNegative });
          seekTo(time, allowNegative);
        },
        getStoreState: () => useStore.getState(),
      };

      recordingEngineRef.current = new RecordingEngine(config, callbacks);
    }

    // Update RecordingEngine config (excluding isPlaying - handled separately)
    if (recordingEngineRef.current) {
      recordingEngineRef.current.updateConfig({
        rawRecordingMode,
        globalLatencyMs: globalLatencyMs || 0,
        extraLatencyMs: extraLatencyMs || 0,
        bpm: bpm || 120,
        timeSignature: timeSignature || [4, 4],
        preRollMode,
        currentTime,
        isPlaying,
        useAudioWorklet,
      });
    }

    // Update MetronomeEngine config
    if (metronomeEngineRef.current) {
      metronomeEngineRef.current.updateConfig({
        bpm: bpm || 120,
        timeSignature: timeSignature || [4, 4],
        isPlaying,
      });
    }

    return () => {
      if (recordingEngineRef.current) {
        recordingEngineRef.current.cleanup();
      }
      if (metronomeEngineRef.current) {
        metronomeEngineRef.current.cleanup();
      }
    };
  }, [rawRecordingMode, globalLatencyMs, extraLatencyMs, bpm, timeSignature, preRollMode]);

  // Separate effect to update isPlaying without destroying audioWorkletNode
  useEffect(() => {
    if (recordingEngineRef.current) {
      recordingEngineRef.current.updateConfig({ isPlaying });
    }
  }, [isPlaying]);

  const lastZoomRef = useRef<number>(zoom);
  const lastVolumesRef = useRef<Map<number, number>>(new Map());
  const lastTimeUpdateRef = useRef<number>(0);

  const adjustLayout = useCallback(() => {
    if (!containerRef.current || !multitrackRef.current) return;
    
    containerRef.current.classList.add('multitrack-container');
    
    const expandedHeight = Math.floor(trackHeight * 1.5);
    const normalHeight = trackHeight;
    const currentMetronomeHeight = metronomeHeight;
    
    // Use tracks state directly
    const currentTracks = tracks || [];
    
    let totalHeight = 0;
    currentTracks.forEach(t => {
      const isMetronome = t.id === 'metronome';
      const isExpanded = t.id === selectedTrackId && !envelopeLocked && !isMetronome;
      totalHeight += isMetronome ? currentMetronomeHeight : (isExpanded ? expandedHeight : normalHeight);
    });

    let css = `
      :root {
        --expanded-track-h: ${expandedHeight}px;
        --normal-track-h: ${normalHeight}px;
      }
      .multitrack-container > div > div {
        height: ${totalHeight}px !important;
        min-height: ${totalHeight}px !important;
        max-height: ${totalHeight}px !important;
        overflow: hidden !important;
      }
    `;

    let previousTrackId: string | null = null;
    const multitrackItems = (multitrackRef.current as { tracks: TrackOptions[] }).tracks || [];
    
    // Check if DOM elements are rendered
    const trackElements = document.querySelectorAll('.multitrack-container > div > div > div');
    
    // If multitrack hasn't populated tracks yet, or DOM elements aren't rendered, retry shortly
    if (multitrackItems.length === 0 || trackElements.length === 0) {
      setTimeout(adjustLayout, 100);
      return;
    }

    for (let i = 0; i < multitrackItems.length; i++) {
      const item = multitrackItems[i];
      const childIndex = i + 2; 
      
      const isNewTrack = item.trackId !== previousTrackId;
      const track = currentTracks.find(t => t.id === item.trackId);
      const isMetronome = track?.id === 'metronome';
      const isExpanded = track?.id === selectedTrackId && !envelopeLocked && !isMetronome;
      const h = isMetronome ? currentMetronomeHeight : (isExpanded ? expandedHeight : normalHeight);

      css += `
        .multitrack-container > div > div > div:nth-child(${childIndex}) {
          z-index: ${isMetronome ? 1000 : 10 + i} !important;
          height: ${h}px !important;
          opacity: 0.8 !important;
          mix-blend-mode: screen !important;
          ${!isNewTrack ? `margin-top: -${h}px !important;` : `margin-top: 0px !important;`}
        }
      `;
      
      if (isNewTrack && previousTrackId !== null) {
        css += `
          .multitrack-container > div > div > div:nth-child(${childIndex})::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background-color: #4A5568;
            z-index: 50;
            pointer-events: none;
          }
        `;
      }
      
      previousTrackId = item.trackId;
    }

    let styleEl = document.getElementById('multitrack-custom-layout');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'multitrack-custom-layout';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;

    // Layout is now applied, we can show the UI
    setIsReady(true);
    if (containerRef.current) {
      containerRef.current.style.opacity = '1';
    }
  }, [selectedTrackId, envelopeLocked, tracks, setIsReady, trackHeight, metronomeHeight]);

  const trackStructureHash = useMemo(() => {
    // Only hash the structural elements that require a full engine rebuild
    return (tracks || []).map(t => 
      `${t.id}:${(t.phrases || []).map(p => `${p.id}:${p.url}`).join('|')}`
    ).join(',') + `|bpm:${bpm}|ts:${timeSignature?.[0]}/${timeSignature?.[1]}`;
  }, [tracks, bpm, timeSignature]);

  // Initialize Multitrack
  useEffect(() => {
    if (!containerRef.current) return;

    perfLogger.log(1);
    setIsReady(false);
    if (containerRef.current) {
      containerRef.current.style.opacity = '0';
      containerRef.current.style.transition = 'opacity 0.3s ease-in-out';
    }

    
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      // Create AudioContext if not exists or closed
      audioContextRef.current = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
    }
    
    // Resume if suspended (should not happen as we create it here, but just in case)
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
    
    // Ensure AudioContext is not null
    if (!audioContextRef.current) {
      throw new Error('Failed to create AudioContext');
    }
    
    const multitrackItems: (TrackOptions & { trackId: string })[] = [];

    const pixelRatio = waveformQuality === 'low' ? 1 : waveformQuality === 'medium' ? Math.max(1, window.devicePixelRatio / 2) : window.devicePixelRatio;
    const sampleRate = waveformQuality === 'low' ? 8000 : waveformQuality === 'medium' ? 16000 : 44100;

    const beatsPerSecond = (bpm || 120) / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const secondsPerBar = secondsPerBeat * (timeSignature?.[0] || 4);

    (tracks || []).forEach(t => {
      const isMetronome = t.id === 'metronome';
      if (t.phrases.length === 0) {
        multitrackItems.push({
          id: t.id, // Use track ID as phrase ID for empty tracks
          trackId: t.id,
          url: SILENT_WAV,
          startPosition: 0,
          volume: 0,
            options: {
              waveColor: t.color,
              progressColor: t.color,
              height: isMetronome ? metronomeHeight : (t.id === selectedTrackId && !envelopeLocked ? Math.floor(trackHeight * 1.5) : trackHeight),
              pixelRatio,
              sampleRate,
              // FIXED: Don't create WebAudioPlayer here - let multitrack handle it with audioOffset
            } as unknown as TrackOptions['options']
          });
      } else {
        t.phrases.forEach(p => {
          // Metronome phrases are already in Real Time (starting from 0)
          // Other phrases are in User Time (starting from 0, which is Bar 1)
          // Apply track-level offset for manual nudge/latency compensation
          const realStartPosition = isMetronome ? p.startPosition : p.startPosition + secondsPerBar + (t.offset || 0);
          
          multitrackItems.push({
            id: p.id,
            trackId: t.id,
            url: p.url,
            audioBuffer: p.audioBuffer,
            peaks: p.peaks,
            startPosition: realStartPosition,
            startCue: p.startCue,
            endCue: p.endCue,
            volume: t.isMuted ? 0 : t.volume,
            draggable: true,
            options: {
              waveColor: t.color,
              progressColor: t.color,
              height: isMetronome ? metronomeHeight : (t.id === selectedTrackId && !envelopeLocked ? Math.floor(trackHeight * 1.5) : trackHeight),
              pixelRatio,
              sampleRate,
              // FIXED: Don't create WebAudioPlayer here - let multitrack handle it with audioOffset
            } as unknown as TrackOptions['options']
          });
        });
      }
    });

    const multitrack = MultiTrack.create(multitrackItems, {
      container: containerRef.current,
      minPxPerSec: zoom,
      rightButtonDrag: false, // This is for panning the timeline
      cursorWidth: 2,
      cursorColor: '#D72F21',
      trackBackground: '#2D3748',
      audioContext: audioContextRef.current!,
      moveLocked: moveLocked,
      timelineOptions: {
        formatTimeCallback: (seconds: number) => {
          const userTime = seconds - secondsPerBar;
          const absTime = Math.abs(userTime);
          const mins = Math.floor(absTime / 60);
          const secs = Math.floor(absTime % 60);
          const sign = userTime < 0 ? '-' : '';
          return `${sign}${mins}:${secs.toString().padStart(2, '0')}`;
        }
      },
      preRollDuration: secondsPerBar
      // We MUST NOT use trackBorderColor here. The library's source code blindly 
      // inserts a 2px <div> before EVERY item in the array if this is set, 
      // which breaks our nth-child math and adds 2px of vertical space per clip.
      // We will draw the borders manually in CSS instead.
    });

    multitrackRef.current = multitrack;
    setMultitrack(multitrack);
    useStore.getState().setMultitrackTimeGetter(() => {
      const realTime = multitrack.getCurrentTime();
      return realTime - secondsPerBar;
    });

    multitrack.on('canplay', () => {
      const storeState = useStore.getState();
      const realTime = storeState.currentTime + secondsPerBar;
      
      // Sync the playhead to the store's current time (which is 0 UserTime initially)
      if (typeof multitrack.setTime === 'function') {
        multitrack.setTime(realTime);
      }
      
      // Delay setting isReady until layout is adjusted
      adjustLayout();
      
      // Calculate max duration in User Time
      let maxDuration = 0;
      const wssList = multitrack.wavesurfers || [];
      wssList.forEach((ws: WaveSurfer) => {
        try {
          // Get trackId from wavesurfer options (set during creation)
          const wsTrackId = (ws as any).options?.trackId || (ws as any).options?.id;
          
          // Skip metronome track
          if (wsTrackId === 'metronome' || wsTrackId === 'placeholder') return;
          
          // Find matching item(s) in multitrackItems by trackId
          const matchingItems = multitrackItems.filter(item => item.trackId === wsTrackId);
          if (matchingItems.length === 0) return;
          
          // Use the first matching item (or calculate max duration across all phrases for this track)
          const d = ws.getDuration();
          const item = matchingItems[0];
          const realStartPos = item.startPosition || 0;
          const userStartPos = realStartPos - secondsPerBar;
          if (d + userStartPos > maxDuration) maxDuration = d + userStartPos;
        } catch {
          // ignore
        }
      });
      setDuration(maxDuration);
    });

    return () => {
      multitrack.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackStructureHash, waveformQuality, bpm, setDuration, timeSignature?.[0], timeSignature?.[1], secondsPerBar]);

  useEffect(() => {
    if (!multitrack) return;

    // Remove redundant currentTime listener as we use pollTime for more control
    
    // Listen for clicks on individual wavesurfers to select phrases
    multitrack.on('click', (event: { id: string }) => {
      if (event?.id) {
        const state = useStore.getState();
        state.setSelectedPhraseId(event.id);
        
        // Also select the track
        for (const track of state.tracks) {
          if (track.phrases.some(p => p.id === event.id)) {
            state.setSelectedTrackId(track.id);
            break;
          }
        }
      }
    });

    // Listen for drag events to update the store
    multitrack.on('start-position-change', (event: { id: string; startPosition: number }) => {
      // wavesurfer-multitrack passes an object with { id, startPosition }
      const id = event?.id;
      const startPosition = event?.startPosition;
      
      if (!id || startPosition === undefined) return;
      
      const state = useStore.getState();
      for (const track of state.tracks) {
        if (track.phrases.some(p => p.id === id)) {
          // Only update if the position actually changed to avoid infinite loops
          const phrase = track.phrases.find(p => p.id === id);
          if (phrase && Math.abs(phrase.startPosition - startPosition) > 0.001) {
            state.updatePhrasePosition(track.id, id, startPosition);
          }
          break;
        }
      }
    });
  }, [multitrack, secondsPerBar, setCurrentTime]);

  // Safe polling mechanism for currentTime that doesn't trigger excessive re-renders
  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number;
    
    const pollTime = () => {
      if (!isMounted) return;
      
      if (multitrackRef.current && typeof multitrackRef.current.getCurrentTime === 'function') {
        try {
          const state = useStore.getState();
          const realTime = multitrackRef.current.getCurrentTime();
          const userTime = realTime - secondsPerBar;
          
          // Requirement 1 & 5: Clamp userTime to 0 for display and store, unless recording or pre-rolling
          const isPreRolling = state.isRecording || isPreRollingRef.current;
          const clampedUserTime = isPreRolling ? userTime : Math.max(0, userTime);
          
          // If we were pre-rolling and just passed Bar 1.1 (0s), hide the PRE bar
          if (isPreRollingRef.current && userTime >= 0 && !state.isRecording) {
            isPreRollingRef.current = false;
            if (multitrackRef.current) {
              multitrackRef.current.setRecordingMode(false);
            }
          }
          
          // Increase resolution to 100ms for smoother UI while reducing re-renders
          const stateTime = state.currentTime;
          const now = Date.now();
          if (typeof clampedUserTime === 'number' && !isNaN(clampedUserTime) && (Math.abs(clampedUserTime - stateTime) > 0.1 || (state.isPlaying && now - lastTimeUpdateRef.current > 100))) {
            state.setCurrentTime(clampedUserTime);
            lastTimeUpdateRef.current = now;
          }
          
          // Stop playback if we reached the end of the project duration
          const effectiveDuration = Math.max(60, state.duration);
          if (state.isPlaying && userTime >= effectiveDuration && effectiveDuration > 0 && !state.isRecording) {
            state.setIsPlaying(false);
            if (multitrackRef.current && typeof multitrackRef.current.pause === 'function') {
              multitrackRef.current.pause();
            }
          }
          
          // Apply envelope automation
          const currentTracks = state.tracks || [];
          const anySolo = currentTracks.some(t => t.isSolo);
          
          let itemIndex = 0;
          
          currentTracks.forEach(track => {
            let trackBaseVolume = track.volume;
            if (track.isMuted) trackBaseVolume = 0;
            if (anySolo && !track.isSolo) trackBaseVolume = 0;
            
            // Apply envelope
            let envVal = 1;
            if (track.envelope && track.envelope.length > 0) {
              const nodes = track.envelope;
              if (userTime <= nodes[0].time) {
                envVal = nodes[0].value;
              } else if (userTime >= nodes[nodes.length - 1].time) {
                envVal = nodes[nodes.length - 1].value;
              } else {
                // Interpolate
                for (let i = 0; i < nodes.length - 1; i++) {
                  if (userTime >= nodes[i].time && userTime <= nodes[i+1].time) {
                    const t0 = nodes[i].time;
                    const v0 = nodes[i].value;
                    const t1 = nodes[i+1].time;
                    const v1 = nodes[i+1].value;
                    const ratio = (userTime - t0) / (t1 - t0);
                    envVal = v0 + (v1 - v0) * ratio;
                    break;
                  }
                }
              }
            }
            
            const targetVolume = trackBaseVolume * envVal;

            const wsList = multitrackRef.current.wavesurfers || [];
            const count = track.phrases.length === 0 ? 1 : track.phrases.length;
            
            for (let j = 0; j < count; j++) {
              const ws = wsList[itemIndex];
              if (ws && typeof ws.setVolume === 'function') {
                const lastVol = lastVolumesRef.current.get(itemIndex);
                if (lastVol === undefined || Math.abs(lastVol - targetVolume) > 0.001) {
                  ws.setVolume(targetVolume);
                  lastVolumesRef.current.set(itemIndex, targetVolume);
                }
              }
              itemIndex++;
            }
          });
          
          // Handle sync loop
          const syncLoop = useStore.getState().syncLoop;
          if (syncLoop && userTime >= syncLoop.end) {
            if (typeof multitrackRef.current.setTime === 'function') {
              multitrackRef.current.setTime(syncLoop.start + secondsPerBar);
            }
          }
        } catch {
          // Ignore errors during polling
        }
      }
      animationFrameId = requestAnimationFrame(pollTime);
    };
    
    animationFrameId = requestAnimationFrame(pollTime);

    return () => {
      isMounted = false;
      cancelAnimationFrame(animationFrameId);
      try {
        if (multitrackRef.current) {
          const mt = multitrackRef.current as MultiTrack & { _layoutObserver?: { disconnect: () => void } };
          if (mt._layoutObserver) {
            mt._layoutObserver.disconnect();
          }
          const wssList = multitrackRef.current.wavesurfers || [];
          wssList.forEach((ws: WaveSurfer) => {
            try {
              // Skip placeholder track
              const wsId = (ws as any).options?.id || (ws as any).options?.trackId;
              if (wsId === 'placeholder' || wsId === 'metronome') return;
              
              if (ws.isPlaying()) ws.pause();
            } catch {
              // ignore
            }
          });
          multitrackRef.current.destroy();
        }
      } catch (e) {
        console.error("Error destroying multitrack:", e);
      }
    };
  }, [trackStructureHash, waveformQuality, secondsPerBar]);

  // Sync track heights dynamically
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    const expandedHeight = Math.floor(trackHeight * 1.5);
    const normalHeight = trackHeight;
    const currentMetronomeHeight = metronomeHeight;
    
    const wssList = multitrackRef.current.wavesurfers || [];
    let itemIndex = 0;
    
    (tracks || []).forEach(track => {
      const isMetronome = track.id === 'metronome';
      const isExpanded = track.id === selectedTrackId && !envelopeLocked && !isMetronome;
      const h = isMetronome ? currentMetronomeHeight : (isExpanded ? expandedHeight : normalHeight);
      
      const count = track.phrases.length === 0 ? 1 : track.phrases.length;
      for (let j = 0; j < count; j++) {
        // Skip placeholder track in wssList
        while (itemIndex < wssList.length) {
          const wsId = (wssList[itemIndex] as any).options?.id || (wssList[itemIndex] as any).options?.trackId;
          if (wsId !== 'placeholder') break;
          itemIndex++;
        }
        
        const ws = wssList[itemIndex];
        if (ws && typeof ws.setOptions === 'function') {
          // Only update if height actually changed to prevent flickering
          if (ws.options.height !== h) {
            ws.setOptions({ height: h });
          }
        }
        itemIndex++;
      }
    });
    
    adjustLayout();
  }, [selectedTrackId, envelopeLocked, isReady, tracks, adjustLayout, trackHeight, metronomeHeight]);

  // Sync moveLocked dynamically without recreating the engine
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    multitrackRef.current.setOptions({ moveLocked });
    
    // Update draggable state for all tracks
    if (multitrackRef.current.tracks) {
      multitrackRef.current.tracks.forEach((track: TrackOptions, i: number) => {
        // Only make actual phrases draggable
        if (track.id !== 'placeholder' && !String(track.id).startsWith('empty_')) {
          track.draggable = !moveLocked;
          
          // Update cursor visually
          if (multitrackRef.current.rendering && multitrackRef.current.rendering.containers) {
            const container = multitrackRef.current.rendering.containers[i];
            if (container) {
              container.style.cursor = moveLocked ? 'default' : 'grab';
            }
          }
        }
      });
    }
  }, [moveLocked, isReady]);

  // Sync selection state to regions dynamically
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    const wssList = multitrackRef.current.wavesurfers || [];
    const multitrackItems = (multitrackRef.current as { tracks: TrackOptions[] }).tracks || [];
    
    wssList.forEach((ws: WaveSurfer) => {
      // Get trackId from wavesurfer options
      const wsTrackId = (ws as any).options?.trackId || (ws as any).options?.id;
      
      // Skip placeholder track
      if (wsTrackId === 'placeholder' || wsTrackId === 'metronome') return;
      
      // Find matching item in multitrackItems by trackId
      const item = multitrackItems.find(item => item.trackId === wsTrackId);
      if (!item) return;
      
      if (item && !String(item.id).startsWith('empty_')) {
        const track = (tracks || []).find(t => t.id === item.trackId);
        const phrase = track?.phrases.find(p => p.id === item.id);
        
        if (phrase) {
          try {
            let regionsPlugin = null;
            try {
              regionsPlugin = (ws as { getActivePlugins?: () => unknown[] }).getActivePlugins?.()?.find((p: unknown) => p && typeof (p as { addRegion?: unknown }).addRegion === 'function');
            } catch {
              // ignore
            }
            
            if (!regionsPlugin && RegionsPlugin) {
              regionsPlugin = ws.registerPlugin(RegionsPlugin.create());
            }
            
            if (regionsPlugin) {
              const regions = regionsPlugin.getRegions();
              
              // If the region hasn't been created yet, create it now
              if (regions.length === 0) {
                const addRegion = () => {
                  // Clear any existing regions just in case
                  regionsPlugin.clearRegions();
                  
                  regionsPlugin.addRegion({
                    start: 0,
                    end: ws.getDuration() || 9999,
                    color: 'rgba(0, 0, 0, 0)',
                    drag: false,
                    resize: false,
                  });
                  
                  // Update styling immediately after creation
                  const newRegions = regionsPlugin.getRegions();
                  if (newRegions.length > 0) {
                    const region = newRegions[0];
                    const isSelected = phrase.id === selectedPhraseId;
                    
                    region.setOptions({
                      color: isSelected ? 'rgba(79, 70, 229, 0.2)' : 'rgba(0, 0, 0, 0)'
                    });

                    // If duration wasn't available, update it when ready
                    if (!ws.getDuration()) {
                      const updateDuration = () => {
                        region.setOptions({ end: ws.getDuration() });
                      };
                      ws.once('ready', updateDuration);
                      ws.once('decode', updateDuration);
                    }
                  }
                };

                addRegion();
              } else {
                // Region already exists, just update it
                const region = regions[0];
                const isSelected = phrase.id === selectedPhraseId;
                
                region.setOptions({
                  color: isSelected ? 'rgba(79, 70, 229, 0.2)' : 'rgba(0, 0, 0, 0)' // Light indigo overlay when selected
                });
              }
            }
          } catch (err) {
            console.warn("Error applying regions plugin:", err);
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhraseId, trackStructureHash, isReady]);

  // Sync track start positions dynamically without destroying the engine
  const startPositionsHash = useMemo(() => {
    return (tracks || []).map(t => (t.phrases || []).map(p => p.startPosition).join(',')).join('|');
  }, [tracks]);
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    let itemIndex = 0;
    
    (tracks || []).forEach(track => {
      if (track.phrases.length === 0) {
        itemIndex++;
      } else {
        track.phrases.forEach(phrase => {
          if (typeof multitrackRef.current?.setTrackStartPosition === 'function') {
            // Only set if the position is actually different to avoid infinite loops with the drag event
            // Unfortunately, wavesurfer-multitrack doesn't expose a getTrackStartPosition method,
            // so we rely on the React state being the source of truth.
            
            // We need to be careful here: if the user is actively dragging, we don't want to 
            // fight the drag event. However, since the drag event updates the store, this useEffect
            // will run. Calling setTrackStartPosition with the *same* position the drag just reported
            // should be a no-op visually.
            try {
              perfLogger.log(6, track.id);
              multitrackRef.current.setTrackStartPosition(itemIndex, phrase.startPosition);
            } catch (e) {
              console.warn("Failed to set track start position:", e);
            }
          }
          itemIndex++;
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPositionsHash, trackStructureHash, isReady]);

  // Sync zoom to multitrack (throttled)
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    // Throttle zoom updates to avoid UI lag
    if (Math.abs(lastZoomRef.current - zoom) < 0.1) return;
    
    const timeoutId = setTimeout(() => {
      try {
        if (multitrackRef.current) {
          multitrackRef.current.zoom(zoom);
          // Also update options to ensure it sticks
          if (typeof multitrackRef.current.setOptions === 'function') {
            multitrackRef.current.setOptions({ minPxPerSec: zoom });
          }
          multitrackRef.current.setMainWidth([], multitrackRef.current.maxDuration, multitrackRef.current.options);
          lastZoomRef.current = zoom;
        }
      } catch (e) {
        if (e instanceof Error && e.message !== "No audio loaded") {
          console.warn("Zoom error:", e);
        }
      }
    }, 50); // Small delay for smoother slider interaction
    
    return () => clearTimeout(timeoutId);
  }, [zoom, isReady]);

  // Sync play state to multitrack
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    if (isPlaying && !multitrackRef.current.isPlaying()) {
      try {
        const state = useStore.getState();
        const currentTime = state.currentTime;
        
        // Requirement 4: Strictly for count-ins for playing/recording started with the playhead between 1.1 to 2.1
        // If we are between Bar 1.1 (0s) and Bar 2.1 (secondsPerBar), and not already recording, do a pre-roll
        const preRollMode = useStore.getState().preRollMode;
        if (currentTime >= 0 && currentTime < secondsPerBar && !state.isRecording && preRollMode === 'always') {
          multitrackRef.current.setTime(0); // Start at Bar 0 (RT 0)
          multitrackRef.current.setRecordingMode(true); // Show PRE bar
          
          // We need to track that we are in a playback pre-roll to hide the PRE bar later
          isPreRollingRef.current = true;
        }
        
        multitrackRef.current.play();
      } catch {
        // ignore
      }
    } else if (!isPlaying) {
      if (multitrackRef.current.isPlaying()) {
        try {
          multitrackRef.current.pause();
          multitrackRef.current.setRecordingMode(false); // Ensure PRE bar is hidden
          isPreRollingRef.current = false;
        } catch {
          // ignore
        }
      }
    }
  }, [isPlaying, isReady, secondsPerBar]);

  // Track properties (volume, mute, solo) are handled in the pollTime loop for maximum responsiveness

  const [debouncedBpm, setDebouncedBpm] = useState(bpm);
  const [debouncedTimeSignature, setDebouncedTimeSignature] = useState(timeSignature);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedBpm(bpm);
      setDebouncedTimeSignature(timeSignature);
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [bpm, timeSignature]);

  // Sync BPM and Time Signature to multitrack options
  useEffect(() => {
    if (!multitrackRef.current || !isReady) return;
    
    if (typeof multitrackRef.current.setOptions === 'function') {
      multitrackRef.current.setOptions({
        bpm: debouncedBpm,
        timeSignature: debouncedTimeSignature
      });
      
      // Force a layout update to recalculate pre-roll pixels and scroll
      const container = document.querySelector('.multitrack-container');
      if (container) {
        multitrackRef.current.setMainWidth([], multitrackRef.current.maxDuration, multitrackRef.current.options);
      }
    }
  }, [debouncedBpm, debouncedTimeSignature, isReady]);

  // Generate click track buffer when BPM, Time Signature, or duration changes
  useEffect(() => {
    if (!audioContextRef.current || !isReady) return;
    
    const beatsPerSecond = (debouncedBpm || 120) / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const secondsPerBar = secondsPerBeat * (debouncedTimeSignature?.[0] || 4);
    
    const targetDuration = Math.max(600, duration + 300);
    const targetBars = Math.ceil(targetDuration / secondsPerBar);
    const finalTargetDuration = targetBars * secondsPerBar;
    
    const metronomePhrases = (tracks || []).find(t => t.id === 'metronome')?.phrases || [];
    
    // Check if we need a completely new set of phrases (BPM or time signature changed)
    const needsNewPhrases = metronomePhrases.length === 0 || 
                           metronomeBufferRef.current?.bpm !== debouncedBpm || 
                           metronomeBufferRef.current?.timeSignature !== debouncedTimeSignature;
    
    if (!needsNewPhrases && metronomePhrases[0] && metronomePhrases[0].duration >= finalTargetDuration) return;
    
    perfLogger.log(4);
    
    const fullBuffer = metronomeEngineRef.current!.generateClickTrackBuffer(
      debouncedBpm,
      debouncedTimeSignature,
      finalTargetDuration
    );
    
    metronomeBufferRef.current = { bpm: debouncedBpm, timeSignature: debouncedTimeSignature, buffer: fullBuffer };
    
    // Convert to WAV for WaveSurfer to render properly
    const wav = audioBufferToWav(fullBuffer);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    
    const newPhrases = [{
      id: 'metronome', // Consistent ID
      url,
      blob,
      audioBuffer: fullBuffer,
      startPosition: 0,
      duration: fullBuffer.duration,
      createdAt: Date.now(),
      name: '',
      color: '#718096',
      volume: 1,
      isMuted: false,
      isSolo: false,
      envelope: []
    }];
    
    useStore.setState((state) => {
      const newTracks = state.tracks.map(t => {
        if (t.id === 'metronome') {
          return {
            ...t,
            phrases: newPhrases
          };
        }
        return t;
      });
      return { tracks: newTracks };
    });
  }, [debouncedBpm, debouncedTimeSignature, duration, isReady, tracks, secondsPerBar, waveformQuality, metronomeHeight]);

  const playPause = useCallback(async () => {
    if (!multitrackRef.current) return;

    // Resume AudioContext on user gesture
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (useStore.getState().isRecording) {
      // If recording, stop recording which will also stop playback
      if (recordingEngineRef.current) {
        if (isPreRollingRef.current) {
          recordingEngineRef.current.cancelRecording();
        } else {
          recordingEngineRef.current.stopRecording();
        }
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, setIsPlaying, setIsRecording]);

  const seekTo = useCallback((userTime: number, allowPreRoll = false) => {
    if (!multitrackRef.current) return;
    
    const beatsPerSecond = (bpm || 120) / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const secondsPerBar = secondsPerBeat * (timeSignature?.[0] || 4);
    
    // Manual seeking (from UI) should be clamped to 0.
    // Internal seeking (like for recording pre-roll) can go negative down to one bar.
    const finalUserTime = allowPreRoll ? Math.max(-secondsPerBar, userTime) : Math.max(0, userTime);
    const realTime = finalUserTime + secondsPerBar;

    // Update store immediately for responsiveness
    setCurrentTime(finalUserTime);

    try {
      if (typeof multitrackRef.current.setTime === 'function') {
        multitrackRef.current.setTime(realTime, true); 
      } else {
        // Fallback for older versions
        const maxDuration = multitrackRef.current.maxDuration || 1;
        multitrackRef.current.seekTo(realTime / maxDuration);
      }
    } catch (err) {
      console.error('Seek error:', err);
    }
  }, [bpm, timeSignature, setCurrentTime]);

  const startRecording = useCallback(async (trackId: string) => {
    if (!recordingEngineRef.current) {
      console.error('RecordingEngine not initialized');
      return;
    }
    await recordingEngineRef.current.startRecording(trackId);
  }, []);

  const stopRecording = useCallback(() => {
    if (!recordingEngineRef.current) return;
    recordingEngineRef.current.stopRecording();
  }, []);

  useEffect(() => {
    useStore.getState().setSeekTo(seekTo);
  }, [seekTo]);

  return {
    containerRef,
    multitrackRef,
    playPause,
    seekTo,
    startRecording,
    stopRecording
  };
}
