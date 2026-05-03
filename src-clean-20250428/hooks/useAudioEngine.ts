import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import MultiTrack, { type TrackOptions } from '../lib/multitrack/multitrack';
import WebAudioPlayer from '../lib/multitrack/webaudio';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { useStore } from '../store/useStore';
import { audioBufferToWav } from '../utils/audioBufferToWav';
import { calculatePeaksAsync } from '../utils/audioUtils';
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

export function generateClickTrackBuffer(
  audioContext: AudioContext,
  bpm: number,
  timeSignature: [number, number],
  durationInSeconds: number
): AudioBuffer {
  const sampleRate = audioContext.sampleRate;
  const beatsPerSecond = bpm / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const beatsPerBar = timeSignature[0];
  const secondsPerBar = secondsPerBeat * beatsPerBar;

  // Round up duration to the nearest whole bar
  const totalBars = Math.max(1, Math.ceil(durationInSeconds / secondsPerBar));
  const finalDuration = totalBars * secondsPerBar;

  const buffer = audioContext.createBuffer(1, Math.ceil(finalDuration * sampleRate), sampleRate);
  const data = buffer.getChannelData(0);

  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const time = bar * secondsPerBar + beat * secondsPerBeat;
      const sampleIndex = Math.floor(time * sampleRate);
      
      // Generate a simple click sound (sine wave burst)
      const isFirstBeat = beat === 0;
      const freq = isFirstBeat ? 1500 : 1000;
      const clickDuration = 0.05; // 50ms
      const clickSamples = Math.floor(clickDuration * sampleRate);

      for (let i = 0; i < clickSamples; i++) {
        if (sampleIndex + i < data.length) {
          // Envelope: quick attack, exponential decay
          const envelope = Math.exp(-i / (sampleRate * 0.01));
          data[sampleIndex + i] += Math.sin(2 * Math.PI * freq * (i / sampleRate)) * envelope * 0.5;
        }
      }
    }
  }

  return buffer;
}

export function useAudioEngine() {
  const containerRef = useRef<HTMLDivElement>(null);
  const multitrackRef = useRef<MultiTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const metronomeBufferRef = useRef<{bpm: number, timeSignature: [number, number], buffer: AudioBuffer} | null>(null);
  const isPreRollingRef = useRef(false);
  const [multitrack, setMultitrack] = useState<MultiTrack | null>(null);
  
    const { 
    tracks, 
    zoom, 
    isPlaying,
    isRecording,
    currentTime,
    selectedTrackId,
    selectedPhraseId,
    envelopeLocked,
    waveformQuality,
    bpm,
    timeSignature,
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

  const continuousMicStreamRef = useRef<MediaStream | null>(null);
  const continuousRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingCancelledRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeTrackIdRef = useRef<string | null>(null);
  const recorderStartTimeRef = useRef<number>(0);
  const punchInTimeRef = useRef<number>(0);
  const recordingStartTransportTimeRef = useRef<number>(0);
  const expectedPreRollRef = useRef<number>(0);
  
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

  // Initialize AudioContext once
  useEffect(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
    }
    return () => {
      // We don't close it here anymore to keep it alive between track structure changes
    };
  }, []);

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
      audioContextRef.current = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
    }
    const sharedAudioContext = audioContextRef.current;
    
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
          id: `empty_${t.id}`,
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
            media: new WebAudioPlayer(sharedAudioContext),
          } as unknown as TrackOptions['options']
        });
      } else {
        t.phrases.forEach(p => {
          // Metronome phrases are already in Real Time (starting from 0)
          // Other phrases are in User Time (starting from 0, which is Bar 1)
          const realStartPosition = isMetronome ? p.startPosition : p.startPosition + secondsPerBar;
          
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
              media: new WebAudioPlayer(sharedAudioContext),
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
      audioContext: sharedAudioContext,
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
      wssList.forEach((ws: WaveSurfer, i: number) => {
        try {
          if (multitrackItems[i].trackId === 'metronome') return;
          const d = ws.getDuration();
          const realStartPos = multitrackItems[i].startPosition || 0;
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
          const realTime = multitrackRef.current.getCurrentTime();
          const userTime = realTime - secondsPerBar;
          
          // Requirement 1 & 5: Clamp userTime to 0 for display and store, unless recording or pre-rolling
          const state = useStore.getState();
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
          // Ensure we have a minimum duration of 60s for metronome-only projects
          const effectiveDuration = Math.max(60, state.duration);
          if (state.isPlaying && userTime >= effectiveDuration && effectiveDuration > 0 && !state.isRecording) {
            state.setIsPlaying(false);
            if (multitrackRef.current && typeof multitrackRef.current.pause === 'function') {
              multitrackRef.current.pause();
            }
          }
          
          // Apply envelope automation
          const currentTracks = useStore.getState().tracks || [];
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
    
    wssList.forEach((ws: WaveSurfer, i: number) => {
      const item = multitrackItems[i];
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
    
    const fullBuffer = generateClickTrackBuffer(
      audioContextRef.current,
      debouncedBpm,
      debouncedTimeSignature,
      finalTargetDuration
    );
    
    metronomeBufferRef.current = { bpm: debouncedBpm, timeSignature: debouncedTimeSignature, buffer: fullBuffer };
    
    const newPhrases = [{
      id: `metronome_full`,
      url: `metronome_bar_url?d=${finalTargetDuration}`,
      blob: new Blob(), // Dummy blob
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
  }, [debouncedBpm, debouncedTimeSignature, duration, isReady, tracks, secondsPerBar]);

  const playPause = useCallback(async () => {
    if (!multitrackRef.current) return;

    // Resume AudioContext on user gesture
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (useStore.getState().isRecording) {
      // If recording, stop recording which will also stop playback
      if (isPreRollingRef.current) {
        recordingCancelledRef.current = true;
        isPreRollingRef.current = false;
      }
      if (continuousRecorderRef.current && continuousRecorderRef.current.state !== 'inactive') {
        continuousRecorderRef.current.stop();
      }
      
      setIsRecording(false);
      setIsPlaying(false);
    } else {
      if (!isPlaying && continuousRecorderRef.current && continuousRecorderRef.current.state !== 'inactive') {
        const runningTime = (performance.now() - recorderStartTimeRef.current) / 1000;
        if (runningTime > 5) {
          continuousRecorderRef.current.stop();
        }
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, setIsPlaying, setIsRecording]);

  const seekTo = useCallback((userTime: number, allowPreRoll = false) => {
    if (!multitrackRef.current) return;
    
    const beatsPerSecond = (bpm || 120) / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const secondsPerBar = secondsPerBeat * (timeSignature?.[0] || 4);
    
    // Manual seeking (from UI) should be clamped to 0.
    // Internal seeking (like for recording pre-roll) can go negative.
    const finalUserTime = allowPreRoll ? userTime : Math.max(0, userTime);
    const realTime = finalUserTime + secondsPerBar;

    // Update store immediately for responsiveness
    setCurrentTime(finalUserTime);

    try {
      if (typeof multitrackRef.current.setTime === 'function') {
        multitrackRef.current.setTime(realTime);
      } else {
        // Fallback for older versions
        const maxDuration = multitrackRef.current.maxDuration || 1;
        multitrackRef.current.seekTo(realTime / maxDuration);
      }
    } catch {
      // ignore
    }
  }, [bpm, timeSignature, setCurrentTime]);

  const startContinuousRecorder = useCallback(() => {
    if (!continuousMicStreamRef.current) return;
    
    if (continuousRecorderRef.current && continuousRecorderRef.current.state !== 'inactive') {
      continuousRecorderRef.current.stop();
    }
    
    audioChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(continuousMicStreamRef.current);
    continuousRecorderRef.current = mediaRecorder;
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      // We only process if we were actually recording
      if (!useStore.getState().isRecording && !activeTrackIdRef.current) {
        startContinuousRecorder();
        return;
      }
      
      if (recordingCancelledRef.current) {
        audioChunksRef.current = [];
        activeTrackIdRef.current = null;
        startContinuousRecorder();
        return;
      }
      
      const trackId = activeTrackIdRef.current;
      activeTrackIdRef.current = null;
      
      if (!trackId) return;
      
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const expectedPreRoll = expectedPreRollRef.current;
      const latencyMs = useStore.getState().globalLatencyMs;
      const latencySec = latencyMs / 1000;
      
      // Calculate how much to trim from the beginning of the continuous recording
      const punchInOffsetSec = (punchInTimeRef.current - recorderStartTimeRef.current) / 1000;
      
      let actualTrimSec = 0;
      let startPos = 0;
      
      if (expectedPreRoll > 0) {
        // We had a count-in. We don't need the circular buffer from before the count-in.
        // We just trim the count-in (minus a small 0.5s buffer to catch early notes).
        const keepPreRollSec = 0.5;
        actualTrimSec = punchInOffsetSec + Math.max(0, expectedPreRoll - keepPreRollSec);
        startPos = recordingStartTransportTimeRef.current + Math.max(0, expectedPreRoll - keepPreRollSec) - latencySec;
      } else {
        // No count-in (punch-in during playback). We use the circular buffer.
        const keepPreRollSec = 1.5;
        actualTrimSec = Math.max(0, punchInOffsetSec - keepPreRollSec);
        startPos = recordingStartTransportTimeRef.current - (punchInOffsetSec - actualTrimSec) - latencySec;
      }
      
      console.log('onstop', { expectedPreRoll, latencyMs, latencySec, startPos, actualTrimSec, punchInOffsetSec });
      
      let finalAudioBuffer: AudioBuffer | undefined;
      let finalAudioUrl = audioUrl;
      let finalAudioBlob = audioBlob;
      let peaks: number[][] | undefined;
      
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = audioContextRef.current;
        if (!audioContext) throw new Error('AudioContext not initialized');
        const originalBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        
        // Destructively trim the pre-roll
        const sampleRate = originalBuffer.sampleRate;
        const startSample = Math.floor(actualTrimSec * sampleRate);
        const endSample = originalBuffer.length;
        const newLength = Math.max(1, endSample - startSample);
        
        const trimmedBuffer = audioContext.createBuffer(
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
      
      useStore.getState().addPhrase(trackId, { 
        url: finalAudioUrl, 
        blob: finalAudioBlob,
        audioBuffer: finalAudioBuffer,
        peaks: peaks, // Store pre-calculated peaks
        startPosition: startPos,
        duration: finalAudioBuffer ? finalAudioBuffer.duration : 0.1,
        createdAt: Date.now()
      });
      
      // Instantly restart the continuous recorder for the next recording
      startContinuousRecorder();
    };
    
    recorderStartTimeRef.current = performance.now();
    mediaRecorder.start(100);
  }, []);

  const startRecording = useCallback(async (trackId: string) => {
    try {
      // Resume AudioContext on user gesture
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      if (!continuousMicStreamRef.current) {
        const rawRecordingMode = useStore.getState().rawRecordingMode;
        const constraints = rawRecordingMode 
          ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
          : { audio: true };
          
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        continuousMicStreamRef.current = stream;
        startContinuousRecorder();
      }
      
      activeTrackIdRef.current = trackId;
      
      const storeState = useStore.getState();
      const isCurrentlyPlaying = storeState.isPlaying;
      const preRollMode = storeState.preRollMode;
      
      // If already playing, force no count-in regardless of preRollMode setting
      const effectivePreRollMode = isCurrentlyPlaying ? 'none' : preRollMode;

      if (storeState.currentTime < 0) {
        alert("Cannot start recording during the pre-roll (before Bar 1).");
        return;
      }
      
      // Prevent punching in during the pre-roll (Bar 0)
      const punchInUserTime = Math.max(0, storeState.currentTime);
      
      const beatsPerSecond = storeState.bpm / 60;
      const secondsPerBeat = 1 / beatsPerSecond;
      const secondsPerBar = secondsPerBeat * storeState.timeSignature[0];
      
      // Recording starts 1 bar before punch-in if count-in is enabled
      const recordStartUserTime = effectivePreRollMode !== 'none' ? punchInUserTime - secondsPerBar : punchInUserTime;

      // Seek to pre-roll start (allow negative user time for pre-roll)
      // Only seek if we are NOT already playing (to avoid interrupting playback)
      if (!isCurrentlyPlaying) {
        seekTo(recordStartUserTime, true);
      }

      recordingStartTransportTimeRef.current = recordStartUserTime;
      expectedPreRollRef.current = effectivePreRollMode !== 'none' ? secondsPerBar : 0;
      punchInTimeRef.current = performance.now();
      recordingCancelledRef.current = false;
      isPreRollingRef.current = effectivePreRollMode !== 'none';
      
      // 1. Set recording mode FIRST so engine knows to allow negative seeks/scrolls
      if (multitrackRef.current) {
        multitrackRef.current.setRecordingMode(effectivePreRollMode !== 'none');
      }
      
      // 2. Seek to the start of the pre-roll in Real Time
      // If effectivePreRollMode is 'none', we don't seek back.
      // Only seek if we are NOT already playing (to avoid interrupting playback)
      if (!isCurrentlyPlaying) {
        if (effectivePreRollMode !== 'none') {
          seekTo(recordStartUserTime);
        } else {
          seekTo(punchInUserTime);
        }
      }

      // 3. Coordinated start time for perfect sync
      const audioContext = audioContextRef.current;
      if (!audioContext) throw new Error('AudioContext not initialized');
      
      const recorderStartCtxTime = audioContext.currentTime;

      // Schedule playback with a small buffer to ensure recorder is ready
      const playbackStartCtxTime = recorderStartCtxTime + 0.15; 
      const startDelay = playbackStartCtxTime - recorderStartCtxTime;
      
      // Store the expected pre-roll duration (1 bar + the start delay)
      expectedPreRollRef.current = (effectivePreRollMode !== 'none' ? secondsPerBar : 0) + startDelay;
      
      // 4. Start Playback
      if (multitrackRef.current && typeof multitrackRef.current.play === 'function') {
        if (!isCurrentlyPlaying) {
          multitrackRef.current.play(playbackStartCtxTime);
        }
      }
      
      setIsPlaying(true);
      setIsRecording(true);
      
      // After 1 bar, we are at the punch-in point
      if (effectivePreRollMode !== 'none') {
        setTimeout(() => {
          if (useStore.getState().isRecording) {
            isPreRollingRef.current = false;
          }
        }, secondsPerBar * 1000);
      } else {
        isPreRollingRef.current = false;
      }

    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
      setIsRecording(false);
    }
  }, [setIsPlaying, setIsRecording, seekTo]);

  const stopRecording = useCallback(() => {
    if (continuousRecorderRef.current && continuousRecorderRef.current.state !== 'inactive') {
      continuousRecorderRef.current.stop();
    }
    if (multitrackRef.current) {
      multitrackRef.current.setRecordingMode(false);
    }
    isPreRollingRef.current = false;
    setIsRecording(false);
  }, [setIsRecording]);

  useEffect(() => {
    if (!isRecording && continuousRecorderRef.current && continuousRecorderRef.current.state !== 'inactive') {
      // Don't stop it automatically here, it's managed by stopRecording
      // continuousRecorderRef.current.stop();
    }
  }, [isRecording]);

  return {
    containerRef,
    multitrackRef,
    playPause,
    seekTo,
    startRecording,
    stopRecording
  };
}
