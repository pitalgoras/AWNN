import React, { useState, useRef, useEffect } from 'react';
import { useStore } from './store/useStore';
import { Play, Pause, Square, Mic, Volume2, Settings, Plus, FastForward, Rewind, Music, Upload, Save, FolderOpen, Lock, Unlock, Activity, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from './lib/utils';
import { calculatePeaksAsync } from './utils/audioUtils';
import { useAudioEngine } from './hooks/useAudioEngine';

import { BpmInput } from './components/BpmInput';
import { SyncTool } from './components/SyncTool';
import { EnvelopeEditor } from './components/EnvelopeEditor';
import { ManualCalibrationModal } from './components/ManualCalibrationModal';
import { TimelineGrid } from './components/TimelineGrid';

import { TransportTimeDisplay } from './components/TransportTimeDisplay';
import { PlayheadSlider } from './components/PlayheadSlider';
import { StatusLogger } from './components/StatusLogger';
import { perfLogger } from './utils/PerformanceLogger';

import { formatBarBeat } from './utils/timeFormat';

export default function App() {
  const tracks = useStore(s => s.tracks);
  const cues = useStore(s => s.cues);
  const isPlaying = useStore(s => s.isPlaying);
  const isRecording = useStore(s => s.isRecording);
  const duration = useStore(s => s.duration);
  const zoom = useStore(s => s.zoom);
  const bpm = useStore(s => s.bpm);
  const timeSignature = useStore(s => s.timeSignature);
  const globalLatencyMs = useStore(s => s.globalLatencyMs);
  const selectedTrackId = useStore(s => s.selectedTrackId);
  const moveLocked = useStore(s => s.moveLocked);
  const envelopeLocked = useStore(s => s.envelopeLocked);
  const selectedPhraseId = useStore(s => s.selectedPhraseId);
  
  const isReady = useStore(s => s.isReady);
  const setIsPlaying = useStore(s => s.setIsPlaying);
  const setZoom = useStore(s => s.setZoom);
  const updateTrack = useStore(s => s.updateTrack);
  const addCue = useStore(s => s.addCue);
  const removeCue = useStore(s => s.removeCue);
  const setBpm = useStore(s => s.setBpm);
  const setTimeSignature = useStore(s => s.setTimeSignature);
  const setGlobalLatencyMs = useStore(s => s.setGlobalLatencyMs);
  const setSelectedTrackId = useStore(s => s.setSelectedTrackId);
  const setSelectedPhraseId = useStore(s => s.setSelectedPhraseId);
  const setMoveLocked = useStore(s => s.setMoveLocked);
  const setEnvelopeLocked = useStore(s => s.setEnvelopeLocked);
  const setPreRollMode = useStore(s => s.setPreRollMode);
  const preRollMode = useStore(s => s.preRollMode);
  const resetSettings = useStore(s => s.resetSettings);
  const saveProject = useStore(s => s.saveProject);
  const loadProject = useStore(s => s.loadProject);
  const addTrack = useStore(s => s.addTrack);
  const removeTrack = useStore(s => s.removeTrack);
  const reorderTracks = useStore(s => s.reorderTracks);
  
  const trackHeight = useStore(s => s.trackHeight);
  const metronomeHeight = useStore(s => s.metronomeHeight);
  const sidebarWidth = useStore(s => s.sidebarWidth);
  const setResponsiveLayout = useStore(s => s.setResponsiveLayout);

  const [pendingChange, setPendingChange] = useState<{ type: 'bpm' | 'timeSignature'; value: number | [number, number] } | null>(null);

  const { 
    containerRef, 
    multitrackRef,
    playPause, 
    seekTo, 
    startRecording, 
    stopRecording 
  } = useAudioEngine();

  // secondsPerBar is not used in App.tsx, so removed.
  
  const [showSettings, setShowSettings] = useState(false);
  const [showTracksModal, setShowTracksModal] = useState(false);
  const [showMetronomeSettings, setShowMetronomeSettings] = useState(false);
  const [showCues, setShowCues] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [isManualCalibrating, setIsManualCalibrating] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const muteLongPressTimer = useRef<{ [key: string]: NodeJS.Timeout | null }>({});

  // Initial seek to 00:00:00 (Bar 1)
  useEffect(() => {
    if (isReady) {
      seekTo(0);
    }
  }, [isReady, seekTo]);

  // Handle Responsive Layout
  useEffect(() => {
    const handleResize = () => {
      const headerHeight = window.innerWidth < 640 ? 48 : 64;
      const availableHeight = window.innerHeight - headerHeight - 4; // -4 for playhead slider height
      
      // We want to fit at least 6 items (5 tracks + metronome)
      // Let's say metronome is 0.8 of a normal track height
      const totalUnits = 5 + 0.8;
      let calculatedTrackHeight = Math.floor(availableHeight / totalUnits);
      
      // Constraints
      const maxTrackHeight = 150;
      const minTrackHeight = 40;
      
      if (calculatedTrackHeight > maxTrackHeight) calculatedTrackHeight = maxTrackHeight;
      if (calculatedTrackHeight < minTrackHeight) calculatedTrackHeight = minTrackHeight;
      
      const calculatedMetronomeHeight = Math.floor(calculatedTrackHeight * 0.8);
      const calculatedSidebarWidth = Math.floor(window.innerWidth * 0.25);
      
      setResponsiveLayout({
        trackHeight: calculatedTrackHeight,
        metronomeHeight: calculatedMetronomeHeight,
        sidebarWidth: calculatedSidebarWidth
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setResponsiveLayout]);

  // Close modals on Escape and handle Spacebar for Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowTracksModal(false);
        setShowMetronomeSettings(false);
        setEditingTrackId(null);
        setSelectedPhraseId(null);
      } else if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        e.stopPropagation();
        playPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [setSelectedPhraseId, playPause, setShowTracksModal]);
  const lastTapTime = useRef<{ [key: string]: number }>({});



  // Sync Phrase Names and Selection to DOM for CSS labeling
  useEffect(() => {
    if (!isReady || !multitrackRef.current) return;
    
    const multitrack = multitrackRef.current;
    const wss = multitrack.wavesurfers || [];
    
    // Match wavesurfers to phrases based on the order they were added in useAudioEngine
    const allPhrases: { id: string; name: string }[] = [];
    
    (tracks || []).forEach(t => {
      if (t.phrases.length === 0) {
        allPhrases.push({ id: `empty_${t.id}`, name: '' });
      } else {
        t.phrases.forEach(p => allPhrases.push(p as { id: string; name: string }));
      }
    });

    wss.forEach((ws: { getWrapper: () => HTMLElement }, i: number) => {
      const phrase = allPhrases[i];
      if (!phrase) return;
      
      const wrapper = ws.getWrapper();
      if (wrapper) {
        // Add attributes for CSS labeling and selection highlighting
        if (phrase.id.startsWith('empty_')) {
          wrapper.removeAttribute('data-phrase-id');
          wrapper.removeAttribute('data-selected');
        } else {
          wrapper.setAttribute('data-phrase-id', phrase.id);
          wrapper.setAttribute('data-selected', (phrase.id === selectedPhraseId).toString());
        }
      }
    });
  }, [tracks, selectedPhraseId, isReady, multitrackRef]);

  const autoCalibrateLatency = async () => {
    try {
      // setIsCalibrating(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
      });
      
      const ctx = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(256, 1, 1);
      
      source.connect(processor);
      processor.connect(ctx.destination);
      
      let beepTime = 0;
      let detected = false;
      let timeoutId: NodeJS.Timeout | undefined = undefined;
      
      const finish = (latencyMs?: number) => {
        if (detected) return;
        detected = true;
        clearTimeout(timeoutId);
        processor.disconnect();
        source.disconnect();
        ctx.close();
        stream.getTracks().forEach(t => t.stop());
        // setIsCalibrating(false);
        
        if (latencyMs !== undefined) {
          // Clamp to reasonable values (0 - 1000ms)
          const finalLatency = Math.max(0, Math.min(1000, Math.round(latencyMs)));
          setGlobalLatencyMs(finalLatency);
          alert(`Auto-calibration successful! Latency set to ${finalLatency}ms.`);
        } else {
          alert('Auto-calibration failed. Could not detect the test tone. Make sure your speakers are on and the microphone can hear them.');
        }
      };
      
      processor.onaudioprocess = (e) => {
        if (detected || beepTime === 0) return;
        
        const data = e.inputBuffer.getChannelData(0);
        const currentTime = ctx.currentTime;
        
        // Only start looking for the beep after it was scheduled to play
        if (currentTime < beepTime) return;
        
        for (let i = 0; i < data.length; i++) {
          if (Math.abs(data[i]) > 0.15) { // Threshold for the beep
            // Calculate exact time of the sample
            const sampleTime = currentTime + (i / ctx.sampleRate);
            const latencyMs = (sampleTime - beepTime) * 1000;
            finish(latencyMs);
            return;
          }
        }
      };
      
      // Play beep
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1000;
      
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      
      // Schedule beep slightly in the future to ensure everything is ready
      beepTime = ctx.currentTime + 0.5;
      
      env.gain.setValueAtTime(1, beepTime);
      env.gain.exponentialRampToValueAtTime(0.001, beepTime + 0.1);
      
      osc.connect(env);
      env.connect(ctx.destination);
      
      osc.start(beepTime);
      osc.stop(beepTime + 0.2);
      
      // Timeout after 2 seconds
      timeoutId = setTimeout(() => finish(), 2000);
      
    } catch (err) {
      console.error("Calibration error:", err);
      alert("Could not access microphone for calibration.");
      // setIsCalibrating(false);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!containerRef.current || !multitrackRef.current) return;
    
    // Disallow seeking during recording
    if (useStore.getState().isRecording) return;

    // Only handle if clicking on the background, not on a phrase
    if ((e.target as HTMLElement).closest('.phrase-container')) return;

    // Stop propagation to prevent MultiTrack's built-in click handler from firing
    e.stopPropagation();

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    const beatsPerSecond = (bpm || 120) / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const secondsPerBar = secondsPerBeat * (timeSignature?.[0] || 4);

    // Get scroll position from the MultiTrack scroll container
    let scrollLeft = 0;
    const scrollContainer = containerRef.current.querySelector('.multitrack-scroll-container') as HTMLElement;
    if (scrollContainer) {
      scrollLeft = scrollContainer.scrollLeft;
    }

    const realTime = (x + scrollLeft) / zoom;
    const userTime = realTime - secondsPerBar;
    console.log('handleContainerClick', { x, scrollLeft, zoom, secondsPerBar, realTime, userTime });
    
    console.log('Click:', { x, scrollLeft, zoom, realTime, userTime, secondsPerBar });
    
    seekTo(userTime);
  };

  // Add native double-click listener to the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // If horizontal scroll, let it pan natively
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return;
      }

      // Vertical scroll -> zoom
      e.preventDefault();

      const state = useStore.getState();
      const currentZoom = state.zoom;
      
      // Calculate zoom delta
      // e.deltaY > 0 means scrolling down (zoom out)
      // e.deltaY < 0 means scrolling up (zoom in)
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      let newZoom = currentZoom * zoomFactor;
      newZoom = Math.max(10, Math.min(200, newZoom)); // Clamp zoom

      if (Math.abs(newZoom - currentZoom) < 0.1) return;

      // Find scroll container
      let scrollContainer: HTMLElement | null = null;
      const firstChild = container.firstChild;
      if (firstChild instanceof HTMLElement && firstChild.shadowRoot) {
        scrollContainer = firstChild.shadowRoot.querySelector('.scroll');
      } else if (container.shadowRoot) {
        scrollContainer = container.shadowRoot.querySelector('.scroll');
      }

      if (scrollContainer) {
        const rect = scrollContainer.getBoundingClientRect();
        const pointerX = e.clientX - rect.left;
        const scrollLeft = scrollContainer.scrollLeft;
        
        // Time at pointer
        const pointerTime = (scrollLeft + pointerX) / currentZoom;

        // Apply new zoom directly to multitrack if available
        if (multitrackRef.current) {
          try {
            multitrackRef.current.zoom(newZoom);
            if (typeof multitrackRef.current.setOptions === 'function') {
              multitrackRef.current.setOptions({ minPxPerSec: newZoom });
            }
          } catch (e) {
            console.warn("Error zooming directly:", e);
          }
        }

        // Apply new zoom to state
        state.setZoom(newZoom);

        // Calculate new scroll position
        // Since we zoomed directly, we can set scrollLeft immediately
        scrollContainer.scrollLeft = pointerTime * newZoom - pointerX;
      } else {
        state.setZoom(newZoom);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    const handleDoubleClick = (e: MouseEvent) => {
      const state = useStore.getState();
      const currentTracks = state.tracks;
      const currentSelectedTrackId = state.selectedTrackId;
      const currentEnvelopeLocked = state.envelopeLocked;

      const rect = container.getBoundingClientRect();
      
      // Attempt to get offset from shadow DOM
      let tracksOffsetTop = 0;
      const firstChild = container.firstChild;
      
      if (firstChild instanceof HTMLElement && firstChild.shadowRoot) {
        const scrollContainer = firstChild.shadowRoot.querySelector('.scroll');
        if (scrollContainer) {
          const canvases = scrollContainer.querySelector('.canvases');
          if (canvases) {
            const canvasesRect = canvases.getBoundingClientRect();
            tracksOffsetTop = canvasesRect.top - rect.top;
          }
        }
      } else if (container.shadowRoot) {
        const canvases = container.shadowRoot.querySelector('.canvases');
        if (canvases) {
          const canvasesRect = canvases.getBoundingClientRect();
          tracksOffsetTop = canvasesRect.top - rect.top;
        }
      }

      const y = e.clientY - rect.top - tracksOffsetTop;
      
      let trackIndex = -1;
      let currentY = 0;
      const rootStyle = getComputedStyle(document.documentElement);
      const expandedH = parseInt(rootStyle.getPropertyValue('--expanded-track-h')) || 80;
      const normalH = parseInt(rootStyle.getPropertyValue('--normal-track-h')) || 50;

      const trackList = currentTracks || [];
      for (let i = 0; i < trackList.length; i++) {
        const h = (trackList[i].id === currentSelectedTrackId && !currentEnvelopeLocked) ? expandedH : normalH;
        if (y >= currentY && y < currentY + h) {
          trackIndex = i;
          break;
        }
        currentY += h;
      }
      
      if (trackIndex < 0 || trackIndex >= trackList.length) return;
      
      const clickedTrack = trackList[trackIndex];
      const currentTime = state.getMultitrackTime();
      
      // Find which phrase is at the current time
      let clickedPhraseId = null;
      for (const p of clickedTrack.phrases) {
        const visualStart = p.startPosition;
        const visualEnd = p.startPosition + (p.endCue || p.duration) - (p.startCue || 0);
        
        // Use a slightly larger buffer for double-clicks
        if (currentTime >= visualStart - 0.1 && currentTime <= visualEnd + 0.1) {
          clickedPhraseId = p.id;
          break;
        }
      }
      
      if (clickedPhraseId) {
        state.setSelectedPhraseId(clickedPhraseId);
        state.setSelectedTrackId(clickedTrack.id);
      } else {
        state.setSelectedPhraseId(null);
        state.setSelectedTrackId(clickedTrack.id);
      }
    };

    container.addEventListener('dblclick', handleDoubleClick);
    return () => {
      container.removeEventListener('dblclick', handleDoubleClick);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef, multitrackRef]);


  const handlePlayPause = () => {
    playPause();
  };

  const handleStop = () => {
    setIsPlaying(false);
    if (isRecording) {
      stopRecording();
    }
    seekTo(0);
  };

  const handleRecord = async (trackId: string) => {
    if (isRecording) {
      perfLogger.log(8);
      stopRecording();
      return;
    }
    
    setSelectedTrackId(trackId);
    
    if (trackId === 'metronome') {
      alert("Recording on the metronome track is not allowed.");
      return;
    }
    
    perfLogger.log(7, trackId);
    startRecording(trackId);
  };

  const handleTrackPointerDown = (trackId: string) => {
    if (trackId === 'metronome') return;
    longPressTimer.current = setTimeout(() => {
      setEditingTrackId(trackId);
    }, 800); // Increased to 800ms to avoid conflict with double-tap
  };

  const handleMutePointerDown = (e: React.PointerEvent, trackId: string) => {
    e.stopPropagation();
    muteLongPressTimer.current[trackId] = setTimeout(() => {
      const track = tracks.find(t => t.id === trackId);
      if (track) {
        updateTrack(trackId, { isSolo: !track.isSolo });
        muteLongPressTimer.current[trackId] = null;
      }
    }, 500);
  };

  const handleMutePointerUp = (e: React.PointerEvent, trackId: string, isMuted: boolean) => {
    e.stopPropagation();
    if (muteLongPressTimer.current[trackId]) {
      clearTimeout(muteLongPressTimer.current[trackId]!);
      muteLongPressTimer.current[trackId] = null;
      // Short tap: toggle mute
      updateTrack(trackId, { isMuted: !isMuted });
    }
  };

  const handleTrackPointerUp = (trackId: string) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      
      // It was a tap, not a long press
      const now = Date.now();
      const lastTap = lastTapTime.current[trackId] || 0;
      
      if (now - lastTap < 300) {
        // Double tap - select track and open settings
        setSelectedTrackId(trackId);
        setEditingTrackId(trackId);
        lastTapTime.current[trackId] = 0; // reset
      } else {
        // Single tap
        setSelectedTrackId(trackId);
        lastTapTime.current[trackId] = now;
      }
    }
  };

  const handleTrackPointerLeave = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800">
      <StatusLogger />
      
      {/* Loading Overlay */}
      {!isReady && (
        <div className="fixed inset-0 z-[1000] bg-zinc-950 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-zinc-800 border-t-zinc-100 rounded-full animate-spin" />
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Initializing Engine</h2>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">Preparing Audio Worklets & Waveforms</p>
          </div>
        </div>
      )}
      
      {/* Combined Header & Transport */}
      <header className="h-10 sm:h-12 border-b border-zinc-800 bg-zinc-900/90 flex items-center px-2 sm:px-4 shrink-0 z-50 w-full">
        {/* Left: Logo & Project Actions */}
        <div className="flex-1 flex items-center gap-2 sm:gap-4 justify-start overflow-hidden">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700">
              <Music className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-400" />
            </div>
            <h1 className="font-semibold text-xs sm:text-sm tracking-wide hidden lg:block">AWNN</h1>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <button onClick={saveProject} className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors" title="Save"><Save size={14} className="sm:w-4 sm:h-4" /></button>
            <button onClick={loadProject} className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors" title="Load"><FolderOpen size={14} className="sm:w-4 sm:h-4" /></button>
          </div>
          
          {/* BPM & Signature in Header */}
          <div className="flex items-center gap-2 ml-2 border-l border-zinc-800 pl-4">
            <button 
              onClick={() => setShowMetronomeSettings(true)}
              className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-800 rounded transition-colors group"
              title="Metronome & Grid Settings"
            >
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter leading-none">Tempo</span>
                <span className="text-xs font-mono font-bold text-zinc-300 group-hover:text-white transition-colors">{bpm} BPM</span>
              </div>
              <div className="w-px h-4 bg-zinc-800 mx-1" />
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter leading-none">Sig</span>
                <span className="text-xs font-mono font-bold text-zinc-300 group-hover:text-white transition-colors">{timeSignature[0]}/{timeSignature[1]}</span>
              </div>
            </button>
            
            {/* Metronome Mute Toggle */}
            <div className="flex items-center gap-1.5 ml-1">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  const metronome = tracks.find(t => t.id === 'metronome');
                  if (metronome) updateTrack('metronome', { isMuted: !metronome.isMuted });
                }}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded transition-colors border border-transparent",
                  tracks.find(t => t.id === 'metronome')?.isMuted 
                    ? "text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800" 
                    : "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20"
                )}
                title="Toggle Metronome"
              >
                <Volume2 size={12} className={cn(tracks.find(t => t.id === 'metronome')?.isMuted && "opacity-50")} />
                <span className="text-[9px] font-bold uppercase tracking-widest hidden sm:block">Metro</span>
              </button>
            </div>
          </div>
        </div>

        {/* Center: Transport Controls */}
        <div className="flex-1 flex justify-center items-center gap-2 sm:gap-6">
          <div className="hidden md:block">
            <TransportTimeDisplay />
          </div>
          
          <div className="flex items-center gap-1 sm:gap-3">
            <button onClick={() => seekTo(0)} className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-all"><Rewind size={14} className="sm:w-4 sm:h-4" /></button>
            <button onClick={handleStop} className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-all"><Square size={14} className="sm:w-4 sm:h-4" fill="currentColor" /></button>
            <button 
              onClick={handlePlayPause}
              className={cn(
                "w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all shadow-lg",
                isPlaying 
                  ? "bg-zinc-100 text-zinc-900 hover:bg-white" 
                  : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700"
              )}
            >
              {isPlaying ? <Pause size={16} className="sm:w-5 sm:h-5" fill="currentColor" /> : <Play size={16} className="sm:w-5 sm:h-5 ml-0.5" fill="currentColor" />}
            </button>
            <button onClick={() => seekTo(useStore.getState().currentTime + 10)} className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-all"><FastForward size={14} className="sm:w-4 sm:h-4" /></button>
          </div>
        </div>

        {/* Right: Settings & View Toggles */}
        <div className="flex-1 flex items-center gap-1 sm:gap-3 justify-end overflow-hidden">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMoveLocked(!moveLocked)}
              className={cn("p-1.5 sm:p-2 rounded transition-colors", moveLocked ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10")}
              title={moveLocked ? "Movement Locked" : "Movement Unlocked"}
            >
              {moveLocked ? <Lock size={12} className="sm:w-3.5 sm:h-3.5" /> : <Unlock size={12} className="sm:w-3.5 sm:h-3.5" />}
            </button>
            <button
              onClick={() => setEnvelopeLocked(!envelopeLocked)}
              className={cn("p-1.5 sm:p-2 rounded transition-colors", envelopeLocked ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10")}
              title={envelopeLocked ? "Envelopes Locked" : "Envelopes Unlocked"}
            >
              <Activity size={12} className="sm:w-3.5 sm:h-3.5" />
            </button>
          </div>

          <div className="hidden lg:flex items-center gap-2 border-l border-zinc-800 pl-3 ml-1">
            <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">Zoom</span>
            <input 
              type="range" 
              min="10" max="200" 
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-16 h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1 border-l border-zinc-800 pl-1 sm:pl-3 ml-0.5 sm:ml-1">
            <button 
              onClick={() => {
                const modes = ['always', 'recording', 'none'] as const;
                const nextMode = modes[(modes.indexOf(preRollMode) + 1) % modes.length];
                setPreRollMode(nextMode);
              }}
              className={cn("p-1.5 sm:p-2 rounded transition-colors", "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800")}
              title={`Pre-roll: ${preRollMode}`}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest">{preRollMode.substring(0, 3)}</span>
            </button>
            <button 
              onClick={() => setShowCues(!showCues)}
              className={cn("p-1.5 sm:p-2 rounded transition-colors", showCues ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800")}
              title="Toggle Cues"
            >
              <Music size={14} className="sm:w-4 sm:h-4" />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
              title="Settings"
            >
              <Settings size={14} className="sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Playhead Slider removed */}

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left & Center combined area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Scrollable content row */}
          <div className="flex-1 flex overflow-y-auto">
            
            {/* Left Sidebar - Track Controls */}
            <aside 
              style={{ width: sidebarWidth }}
              className="border-r border-zinc-800 bg-zinc-900/30 shrink-0 flex flex-col"
            >
              <div className="flex flex-col flex-1">
                {(tracks || []).map((track) => {
                  const isMetronome = track.id === 'metronome';
                  const isExpanded = track.id === selectedTrackId && !envelopeLocked && !isMetronome;
                  const currentHeight = isMetronome ? metronomeHeight : (isExpanded ? trackHeight * 1.5 : trackHeight);
                  
                  return (
                    <div 
                      key={track.id}
                      onPointerDown={() => handleTrackPointerDown(track.id)}
                      onPointerUp={() => handleTrackPointerUp(track.id)}
                      onPointerLeave={handleTrackPointerLeave}
                      className={cn(
                        "p-1.5 transition-all cursor-pointer group relative overflow-hidden flex flex-col justify-center border-b border-zinc-800",
                        selectedTrackId === track.id 
                          ? "bg-zinc-800/80 shadow-sm" 
                          : "bg-zinc-900/50 hover:bg-zinc-800/50"
                      )}
                      style={{ height: currentHeight }}
                    >
                      {/* Track Color Indicator - Now on the Right */}
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1.5" 
                        style={{ backgroundColor: track.color }} 
                      />
                      
                      <div className="flex items-center justify-between pl-2 pr-3">
                        {isMetronome ? (
                          <div className="flex items-center gap-3 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center border border-zinc-700">
                                <Activity className="w-3 h-3 text-zinc-500" />
                              </div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Metronome</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm font-medium truncate pr-2">{track.name}</span>
                        )}
                        <div className="flex gap-1">
                          <button 
                            onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                            onPointerUp={(e) => handleMutePointerUp(e, track.id, track.isMuted)}
                            onPointerLeave={(e) => { e.stopPropagation(); if (muteLongPressTimer.current[track.id]) { clearTimeout(muteLongPressTimer.current[track.id]!); muteLongPressTimer.current[track.id] = null; } }}
                            className={cn(
                              "w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold transition-all select-none",
                              track.isSolo 
                                ? "bg-yellow-500 text-yellow-950 shadow-[0_0_10px_rgba(234,179,8,0.4)]" 
                                : track.isMuted 
                                  ? "bg-red-500/20 text-red-400" 
                                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                            )}
                            title="Tap to Mute, Hold to Solo"
                          >
                            {track.isSolo ? 'S' : 'M'}
                          </button>
                          {!isMetronome && (
                            <button 
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRecord(track.id); }}
                              className={cn(
                                "w-7 h-7 rounded flex items-center justify-center transition-colors",
                                isRecording && selectedTrackId === track.id
                                  ? "bg-red-500 text-white animate-pulse" 
                                  : "bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-300"
                              )}
                            >
                              <Mic className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Tracks Management Section is now in Settings */}
              </div>
            </aside>
            
            {/* Center - Waveforms */}
            <section className="flex-1 bg-zinc-950 relative overflow-hidden">
              {/* Cues Overlay */}
              <div className="absolute top-0 left-0 right-0 h-6 z-40 pointer-events-none overflow-hidden">
                {cues.map((cue) => (
                  <div 
                    key={cue.id}
                    className="absolute top-0 bottom-0 w-px bg-yellow-500/50 group cursor-pointer pointer-events-auto"
                    style={{ left: `${(cue.time / (duration || 1)) * 100}%` }}
                    onClick={() => seekTo(cue.time)}
                  >
                    <div className="absolute top-6 -translate-x-1/2 bg-zinc-900/90 border border-yellow-500/30 text-yellow-500 text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-xl">
                      {cue.label}
                    </div>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
                  </div>
                ))}
              </div>

              <div 
                ref={containerRef} 
                className="w-full multitrack-container timeline-container relative z-20" 
                onClickCapture={handleContainerClick}
              />
              {isReady && <TimelineGrid />}
              {isReady && <SyncTool />}
              {isReady && <EnvelopeEditor />}
            </section>
          </div>
        </div>
        
        {/* Right Sidebar - Cues List */}
        {showCues && (
          <aside className="w-64 border-l border-zinc-800 bg-zinc-900/30 flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
            
            {/* Cues List */}
            <div className="p-3 border-b border-zinc-800 sticky top-0 bg-zinc-900/90 backdrop-blur-sm z-10 flex justify-between items-center">
              <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Cues</span>
              <button 
                onClick={() => addCue({ time: useStore.getState().currentTime, label: `Cue ${cues.length + 1}` })}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors"
                title="Add Cue"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {cues.length === 0 ? (
                <div className="text-center p-4 text-xs text-zinc-600">No cues added yet.</div>
              ) : (
                cues.map((cue, index) => (
                  <div 
                    key={cue.id}
                    className="flex items-center justify-between p-2 rounded hover:bg-zinc-800/50 cursor-pointer group text-sm"
                  >
                    <div className="flex items-center gap-3 flex-1" onClick={() => seekTo(cue.time)}>
                      <span className="text-zinc-600 font-mono text-xs w-4">{index + 1}</span>
                      <span className="text-zinc-300">{cue.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500 font-mono text-xs">{formatBarBeat(cue.time, bpm, timeSignature)}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCue(cue.id);
                        }}
                        className="p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

        </aside>
      )}

      </main>

      {/* Manual Calibration Modal */}
      {isManualCalibrating && (
        <ManualCalibrationModal onClose={() => setIsManualCalibrating(false)} />
      )}

      {/* Settings Modal Overlay */}
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
              <h2 className="text-lg font-bold tracking-tight">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
                <Square className="w-4 h-4 text-zinc-500" />
              </button>
            </div>

            <div className="p-6 space-y-8 max-h-[80vh] overflow-y-auto">
              {/* Latency Section */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    Global Latency
                  </label>
                  <span className="font-mono text-[10px] text-zinc-400">{globalLatencyMs}ms</span>
                </div>
                <div className="space-y-4">
                  <input 
                    type="range" 
                    min="-200" max="200" step="1" 
                    value={globalLatencyMs}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGlobalLatencyMs(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={autoCalibrateLatency}
                      className="flex-1 py-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                      Auto-Calibrate
                    </button>
                    <button 
                      onClick={() => setIsManualCalibrating(true)}
                      className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                      Manual Calibration
                    </button>
                  </div>
                </div>
              </div>

              {/* Tracks Management Button */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">
                  Track Management
                </label>
                <button 
                  onClick={() => {
                    setShowSettings(false);
                    setShowTracksModal(true);
                  }}
                  className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  <Settings size={14} />
                  Manage Tracks
                </button>
              </div>

              {/* Project Section */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">
                  Project
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={saveProject}
                    className="py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                  >
                    Save Project
                  </button>
                  <button 
                    onClick={loadProject}
                    className="py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                  >
                    Load Project
                  </button>
                </div>
              </div>

              <button 
                onClick={() => {
                  if (window.confirm('Are you sure you want to reset all settings to their defaults?')) {
                    resetSettings();
                  }
                }}
                className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
              >
                Reset All Settings
              </button>
            </div>

            <div className="p-6 bg-zinc-900/80 border-t border-zinc-800">
              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracks Modal */}
      {showTracksModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4" onClick={() => setShowTracksModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-bold tracking-tight">Manage Tracks</h2>
              <button onClick={() => setShowTracksModal(false)} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
                <Square className="w-4 h-4 text-zinc-500" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <button 
                onClick={() => {
                  addTrack({
                    name: `Track ${tracks.filter(t => t.id !== 'metronome').length + 1}`,
                    color: '#3b82f6',
                    isMuted: false,
                    isSolo: false,
                    volume: 0.8,
                    pan: 0,
                    offset: 0,
                    phrases: [],
                    envelope: []
                  });
                }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 mb-4"
              >
                <Plus size={14} />
                Add New Track
              </button>

              <div className="space-y-2">
                {(tracks || []).filter(t => t.id !== 'metronome').map((track, index) => (
                  <div key={track.id} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
                    <div 
                      className="relative group/color shrink-0"
                    >
                      <div className="w-4 h-4 rounded-full shadow-inner border border-white/10" style={{ backgroundColor: track.color }} />
                      <input 
                        type="color" 
                        value={track.color}
                        onChange={(e) => updateTrack(track.id, { color: e.target.value })}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <input 
                        value={track.name}
                        onChange={(e) => updateTrack(track.id, { name: e.target.value })}
                        className="bg-transparent border-none focus:ring-0 text-sm font-bold text-zinc-100 p-0 w-full"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => reorderTracks(index, index - 1)}
                        disabled={index === 0}
                        className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 disabled:opacity-20"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button 
                        onClick={() => reorderTracks(index, index + 1)}
                        disabled={index === tracks.filter(t => t.id !== 'metronome').length - 1}
                        className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 disabled:opacity-20"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button 
                        onClick={() => setEditingTrackId(track.id)}
                        className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400"
                      >
                        <Settings size={14} />
                      </button>
                      <button 
                        onClick={() => removeTrack(track.id)}
                        className="p-1.5 hover:bg-zinc-700 rounded text-red-400/50 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 bg-zinc-900/80 border-t border-zinc-800 shrink-0">
              <button 
                onClick={() => setShowTracksModal(false)}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
              >
                Back to Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metronome Settings Modal */}
      {showMetronomeSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={() => setShowMetronomeSettings(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
              <h2 className="text-lg font-bold tracking-tight">Metronome & Grid</h2>
              <button onClick={() => setShowMetronomeSettings(false)} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
                <Square className="w-4 h-4 text-zinc-500" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* BPM Section */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">
                  Tempo (BPM)
                </label>
                <div className="flex items-center justify-center py-4 bg-zinc-800/30 rounded-xl border border-zinc-800/50">
                  <BpmInput 
                    key={`modal-${bpm}`}
                    onPendingChange={(val) => setPendingChange({ type: 'bpm', value: val })}
                  />
                </div>
              </div>

              {/* Signature Section */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">
                  Time Signature
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['4/4', '3/4', '2/4', '6/8', '12/8'].map((sig) => (
                    <button
                      key={sig}
                      onClick={() => {
                        const parts = sig.split('/');
                        const newVal = [Number(parts[0]), Number(parts[1])] as [number, number];
                        if ((tracks || []).some(t => t.id !== 'metronome' && t.phrases.length > 0)) {
                          setPendingChange({ type: 'timeSignature', value: newVal });
                        } else {
                          setTimeSignature(newVal);
                        }
                      }}
                      className={cn(
                        "py-3 rounded-xl text-xs font-mono transition-all border",
                        `${(timeSignature?.[0] || 4)}/${(timeSignature?.[1] || 4)}` === sig
                          ? "bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                          : "bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      {sig}
                    </button>
                  ))}
                </div>
              </div>

              {/* Volume Section */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    Click Volume & Mute
                  </label>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const metronome = tracks.find(t => t.id === 'metronome');
                        if (metronome) updateTrack('metronome', { isMuted: !metronome.isMuted });
                      }}
                      className={cn(
                        "p-1.5 rounded transition-colors",
                        tracks.find(t => t.id === 'metronome')?.isMuted 
                          ? "text-zinc-600 bg-zinc-800" 
                          : "text-emerald-500 bg-emerald-500/10"
                      )}
                    >
                      {tracks.find(t => t.id === 'metronome')?.isMuted ? <Volume2 size={14} className="opacity-50" /> : <Volume2 size={14} />}
                    </button>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {Math.round((tracks.find(t => t.id === 'metronome')?.volume || 0.5) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 px-2">
                  <Volume2 className="w-4 h-4 text-zinc-600" />
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01" 
                    value={tracks.find(t => t.id === 'metronome')?.volume || 0.5}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateTrack('metronome', { volume: parseFloat(e.target.value) })}
                    className="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 bg-zinc-900/80 border-t border-zinc-800">
              <button 
                onClick={() => setShowMetronomeSettings(false)}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Track Edit Modal */}
      {editingTrackId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setEditingTrackId(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold">Track Settings</h2>
              <button onClick={() => setEditingTrackId(null)} className="text-zinc-500 hover:text-zinc-300">
                <Square className="w-4 h-4" />
              </button>
            </div>
            
            {(() => {
              const track = tracks.find(t => t.id === editingTrackId);
              if (!track) return null;
              return (
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
                      Volume
                    </label>
                    <div className="flex items-center gap-4">
                      <Volume2 className="w-4 h-4 text-zinc-500" />
                      <input 
                        type="range" 
                        min="0" max="1" step="0.01" 
                        value={track.volume}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
                        className="flex-1 h-3 bg-zinc-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-zinc-100 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-zinc-400"
                      />
                      <span className="font-mono text-xs w-8 text-right">{Math.round(track.volume * 100)}%</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
                      Offset (seconds)
                    </label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" 
                        min="-1" max="1" step="0.01" 
                        value={track.offset || 0}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateTrack(track.id, { offset: parseFloat(e.target.value) })}
                        className="flex-1 h-3 bg-zinc-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-zinc-100 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-zinc-400"
                      />
                      <span className="font-mono text-xs w-10 text-right">{(track.offset || 0).toFixed(2)}s</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Track Color</label>
                      <div className="flex items-center gap-2">
                        <input 
                          type="color" 
                          value={track.color}
                          onChange={(e) => updateTrack(track.id, { color: e.target.value })}
                          className="w-8 h-8 rounded cursor-pointer border-none bg-transparent"
                        />
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">{track.color}</span>
                      </div>
                    </div>

                    <input 
                      type="file" 
                      accept="audio/*" 
                      className="hidden" 
                      ref={audioInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        perfLogger.log(10, file.name);
                        const reader = new FileReader();
                        reader.onload = async (event) => {
                          perfLogger.log(13);
                          const arrayBuffer = event.target?.result as ArrayBuffer;
                          // Use a temporary AudioContext to decode the audio and get its exact duration
                          const audioContext = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
                          try {
                            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
                            const url = URL.createObjectURL(file);
                            
                            // Pre-calculate peaks to avoid main-thread spikes during WaveSurfer init
                            const peaks = await calculatePeaksAsync(audioBuffer);
                            
                            useStore.getState().addPhrase(track.id, { 
                              url, 
                              blob: file,
                              audioBuffer,
                              peaks,
                              startPosition: useStore.getState().currentTime,
                              duration: audioBuffer.duration,
                              createdAt: Date.now()
                            });
                          } catch (err) {
                            console.error("Error decoding audio:", err);
                            alert("Failed to import audio file.");
                          } finally {
                            audioContext.close();
                          }
                        };
                        reader.readAsArrayBuffer(file);
                        
                        setEditingTrackId(null);
                      }}
                    />
                    <button 
                      onClick={() => audioInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm font-medium transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      Import Audio
                    </button>
                    
                    <button 
                      onClick={() => {
                        fileInputRef.current?.click();
                        setEditingTrackId(null);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm font-medium transition-colors"
                    >
                      <Music className="w-4 h-4" />
                      Import MIDI
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {/* Confirmation Modal for BPM/SIG changes */}
      {pendingChange && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold mb-2">Confirm Project Change</h3>
            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
              Changing the {pendingChange.type === 'bpm' ? 'BPM' : 'Time Signature'} will alter the grid and click track, but will NOT stretch existing audio clips. This may cause misalignment.
            </p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setPendingChange(null)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (pendingChange.type === 'bpm') {
                    setBpm(pendingChange.value as number);
                  } else {
                    setTimeSignature(pendingChange.value as [number, number]);
                  }
                  setPendingChange(null);
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-sm font-medium shadow-lg shadow-emerald-900/20"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

