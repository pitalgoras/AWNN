import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from './store/useStore';
import { Play, Pause, Square, Mic, Metronome, Settings, Plus, FastForward, Rewind, Music, Upload, Save, FolderOpen, Lock, Unlock, Activity, Trash2, ChevronUp, ChevronDown, Maximize, Minimize, Edit3, ListMusic, FileText, Volume2 } from 'lucide-react';
import { cn } from './lib/utils';
import { calculatePeaksAsync } from './audio/processing/audioUtils';
import { useAudioEngine } from './hooks/useAudioEngine';
import { ModalShell } from './components/modals/ModalShell';
import { SettingsModal } from './components/modals/SettingsModal';
import { TrackManagerModal } from './components/modals/TrackManagerModal';
import { MetronomeModal } from './components/modals/MetronomeModal';
import { ImportAudioModal } from './components/modals/ImportAudioModal';
import { autoMatchFileToTrack, trackNameFromFile } from './audio/import/importUtils';

import { BpmInput } from './components/BpmInput';
import { SyncTool } from './components/SyncTool';
import { EnvelopeEditor } from './components/EnvelopeEditor';
import { useToolbarContext, type ScreenSize, type ToolbarType } from './hooks/useToolbarContext';
import { useAdaptiveLabels } from './hooks/useAdaptiveLabels';
import { TimelineGrid } from './components/TimelineGrid';
import { LyricsBuilder } from './components/LyricsBuilder';
import { TrackBar } from './components/TrackBar';
import { exportProject, importProject } from './audio/project/projectIO';

import { TransportTimeDisplay } from './components/TransportTimeDisplay';
import { DeviceChangeBanner } from './components/DeviceChangeBanner';
import { VisualCalibrationModal } from './components/modals/VisualCalibrationModal';
import { perfLogger } from './utils/PerformanceLogger';
import { FeedbackAdmin } from './components/admin/FeedbackAdmin';
import { FeedbackChatPanel, SidebarPanel, useFeedbackActivation } from './feedback';

import { formatBarBeat } from './audio/time/timeFormat';

export default function App() {
  if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/admin/feedback') || window.location.search.includes('admin'))) {
    return <FeedbackAdmin />;
  }
  const tracks = useStore(s => s.tracks);
  const cues = useStore(s => s.cues);
  const isPlaying = useStore(s => s.isPlaying);
  const isRecording = useStore(s => s.isRecording);
  const duration = useStore(s => s.duration);
  const zoom = useStore(s => s.zoom);
  const bpm = useStore(s => s.bpm);
  const timeSignature = useStore(s => s.timeSignature);
  const selectedTrackId = useStore(s => s.selectedTrackId);
  const moveLocked = useStore(s => s.moveLocked);
  const envelopeLocked = useStore(s => s.envelopeLocked);
  const selectedPhraseId = useStore(s => s.selectedPhraseId);
  
  const nonMetronomeCount = useMemo(
    () => tracks.filter(t => t.id !== 'metronome').length,
    [tracks]
  );
  
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
  const metronomeEnabled = useStore(s => s.metronomeEnabled);
  const barLinesEnabled = useStore(s => s.barLinesEnabled);
  const metronomeTrackVisible = useStore(s => s.metronomeTrackVisible);
  const sidebarWidth = useStore(s => s.sidebarWidth);
  const setResponsiveLayout = useStore(s => s.setResponsiveLayout);
  const toolbarProposal = useStore(s => s.toolbarProposal);
  const showTier = (tier: 1 | 2 | 3) => toolbarProposal <= tier;
  const toolbarVisibleLabels = useStore(s => s.toolbarVisibleLabels);
  
  const appMode = useStore(s => s.appMode);
  const setAppMode = useStore(s => s.setAppMode);
  
  // Adaptive Toolbar Hooks for Header
  const mainToolbarRef = useRef<HTMLHeadElement>(null);
  const mainToolbarContext = useToolbarContext('horizontal');
  const { isAbbreviated: mainToolbarAbbreviated, getLabel: mainToolbarLabel } = useAdaptiveLabels(
    mainToolbarRef as React.RefObject<HTMLElement>,
    'horizontal',
    15 // Approximate item count
  );
  
  // Responsive sizing based on screenSize
  const headerScreenSize = mainToolbarContext.screenSize;
  const isSmallPortrait = headerScreenSize === 'small' && mainToolbarContext.isPortrait;  
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const isWidePortrait = isSmallPortrait && windowWidth >= 500;
  const { smallBtnSize, mediumBtnSize, largeBtnSize, setSmallBtnSize, setMediumBtnSize, setLargeBtnSize } = useStore();
  
  // Button size strings (includes padding and text size)
  const btnClassBase = headerScreenSize === 'small' 
    ? `min-h-[${smallBtnSize}px] p-1 text-[9px]`
    : headerScreenSize === 'medium' 
    ? `min-h-[${mediumBtnSize}px] p-1.5 text-[10px]`
    : `min-h-[${largeBtnSize}px] p-2 text-xs`;
  
  const toolbarBtn = (isSquare = false, extra = "") =>
    cn(btnClassBase, "flex items-center justify-center rounded transition-colors shrink-0", isSquare && "aspect-square", extra);
  
  // Derived sizes from button base
  const btnHeight = headerScreenSize === 'small' ? smallBtnSize + 8
    : headerScreenSize === 'medium' ? mediumBtnSize + 12
    : largeBtnSize + 16;
  const PLAY_MULT = 1.5;
  const playBtnPx = Math.round(btnHeight * (isSmallPortrait ? 1.2 : PLAY_MULT));
  const playIconPx = Math.round(playBtnPx * 0.45);
  
  const headerIconSize = headerScreenSize === 'small' ? 12 : headerScreenSize === 'medium' ? 14 : 16;

  const [pendingChange, setPendingChange] = useState<{ type: 'bpm' | 'timeSignature'; value: number | [number, number] } | null>(null);

  const { 
    containerRef, 
    multitrackRef,
    playPause, 
    seekTo, 
    startRecording, 
    stopRecording,
    undoLastRecording,
    cancelAndJumpBack,
  } = useAudioEngine();

  // secondsPerBar is not used in App.tsx, so removed.

  const { showFeedback, setShowFeedback, feedbackActivators, handleCuesClick } = useFeedbackActivation();

  const [showSettings, setShowSettings] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showTracksModal, setShowTracksModal] = useState(false);
  const [showMetronomeSettings, setShowMetronomeSettings] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [showCues, setShowCues] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioImportInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const muteLongPressTimer = useRef<{ [key: string]: NodeJS.Timeout | null }>({});

  const hasInitializedRef = useRef(false);

  // Initial seek to 00:00:00 (Bar 1) — only on first mount
  useEffect(() => {
    if (isReady && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      seekTo(0);
    }
  }, [isReady, seekTo]);

  // Handle Responsive Layout — recalculates on resize, track count, or selection change
  useEffect(() => {
    // Force-reset persisted layout state that might cause issues
    useStore.setState({ 
      toolbarProposal: 1, 
      appMode: 'mixer',
      sidebarWidth: Math.floor(window.innerWidth * 0.25) 
    });
    
    const handleResize = () => {
      const state = useStore.getState();
      const headerHeight = mainToolbarRef.current?.offsetHeight ?? (window.innerWidth < 640 && window.innerHeight > window.innerWidth ? 80 : window.innerWidth < 640 ? 48 : 64);
      const availableHeight = window.innerHeight - headerHeight - 4;
      
      const nonMetronomeTracks = state.tracks.filter(t => t.id !== 'metronome');
      const totalUnits = nonMetronomeTracks.length;
      if (totalUnits === 0) return;
      
      // Account for selected expanded track (1.5x height)
      const hasExpanded = state.selectedTrackId && !state.envelopeLocked;
      const effectiveUnits = totalUnits + (hasExpanded ? 0.5 : 0);
      let calculatedTrackHeight = Math.floor(availableHeight / effectiveUnits);
      
      const minTrackHeight = 44;
      if (calculatedTrackHeight < minTrackHeight) calculatedTrackHeight = minTrackHeight;
      
      const calculatedMetronomeHeight = Math.floor(calculatedTrackHeight * 0.8);
      const calculatedSidebarWidth = Math.floor(window.innerWidth * 0.25);
      const shouldShowLabels = window.innerWidth > 500;

      setResponsiveLayout({
        trackHeight: calculatedTrackHeight,
        metronomeHeight: calculatedMetronomeHeight,
        sidebarWidth: calculatedSidebarWidth
      });
      useStore.getState().setToolbarVisibleLabels(shouldShowLabels);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setResponsiveLayout, nonMetronomeCount, selectedTrackId, envelopeLocked]);

  // Close modals on Escape and handle Spacebar for Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowTracksModal(false);
        setShowMetronomeSettings(false);
        setShowFeedback(false);
        setEditingTrackId(null);
        setSelectedPhraseId(null);
       } else if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable))) {
        e.preventDefault();
        e.stopPropagation();
        playPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [setSelectedPhraseId, playPause, setShowTracksModal]);
  const lastTapTime = useRef<{ [key: string]: number }>({});

  // Fullscreen toggle
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
    };
  }, []);

  // Request fullscreen on first user interaction (tap/click anywhere)
  useEffect(() => {
    const handler = () => {
      document.documentElement.requestFullscreen().catch(() => {});
    };
    document.addEventListener('pointerdown', handler, { once: true });
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  // Logo menu state
  const [showLogoMenu, setShowLogoMenu] = useState(false);

  // Pinch-to-zoom on the multitask container
  const pinchRef = useRef({ dist: 0, zoom: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current.dist = getDist(e.touches[0], e.touches[1]);
        pinchRef.current.zoom = useStore.getState().zoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getDist(e.touches[0], e.touches[1]);
        const ratio = dist / pinchRef.current.dist;
        const newZoom = Math.max(10, Math.min(200, Math.round(pinchRef.current.zoom * ratio)));
        useStore.getState().setZoom(newZoom);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [containerRef]);



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
      // Block seeking during recording
      if (state.isRecording) return;
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
    } else {
      seekTo(0);
    }
  };

  const handleRecord = async (trackId: string) => {
    if (isRecording) {
      perfLogger.log(8);
      // Pause playback first so seek in stopRecording() doesn't corrupt metronome base times
      setIsPlaying(false);
      if (multitrackRef.current && typeof multitrackRef.current.pause === 'function') {
        multitrackRef.current.pause();
      }
      stopRecording();
      return;
    }
    
    if (appMode !== 'lyrics') {
      setSelectedTrackId(trackId);
    }
    
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
    // During recording on this track, mute button cancels + jumps back
    if (isRecording && selectedTrackId === trackId) {
      cancelAndJumpBack();
      return;
    }
    muteLongPressTimer.current[trackId] = setTimeout(() => {
      const track = tracks.find(t => t.id === trackId);
      if (track) {
        updateTrack(trackId, { isSolo: !track.isSolo });
        muteLongPressTimer.current[trackId] = null;
      }
    }, 500);
  };

  const handleMutePointerUp = (e: React.PointerEvent, trackId: string) => {
    e.stopPropagation();
    // During recording on this track, mute up is a no-op (handled by down)
    if (isRecording && selectedTrackId === trackId) return;
    if (muteLongPressTimer.current[trackId]) {
      clearTimeout(muteLongPressTimer.current[trackId]!);
      muteLongPressTimer.current[trackId] = null;
    }
    // Always read fresh isMuted from store — don't trust render-closure value
    const track = useStore.getState().tracks.find(t => t.id === trackId);
    if (track) updateTrack(trackId, { isMuted: !track.isMuted });
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

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importProject(file);
      // Restore the store heavily via localforage override or explicit set
      useStore.setState({
        tracks: data.tracks || [],
        cues: data.cues || [],
        bpm: data.bpm || 120,
        timeSignature: data.timeSignature || [4, 4],
        globalLatencyMs: data.globalLatencyMs || 0,
        lyricsText: data.lyricsText || '',
        lyricsSegments: data.lyricsSegments || [],
      });
      alert('Project loaded from file!');
    } catch (err) {
      console.error(err);
      alert('Failed to parse file.');
    }
  };

  const handleAudioImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImportFiles(Array.from(files));
    setShowImportModal(true);
    (e.target as HTMLInputElement).value = '';
  };

  // Shared toolbar controls — defined once, used in all layouts
  const renderMenuBtn = () => (
    <button onClick={() => setShowLogoMenu(!showLogoMenu)} className={cn(toolbarBtn(true, "rounded-lg hover:bg-zinc-800"))} title="Menu" onMouseDown={(e) => e.stopPropagation()}>
      <Music size={headerIconSize} className="text-zinc-400" />
    </button>
  );

  const renderAppModeBtn = () => {
    return (
      <button onClick={() => setAppMode(appMode === 'mixer' ? 'lyrics' : 'mixer')} className={cn(toolbarBtn(false, "text-xs font-semibold bg-zinc-800 text-white"))}>
        {appMode === 'mixer' ? <FileText size={14} /> : <Mic size={14} />}
        {appMode === 'mixer' ? mainToolbarLabel('Lyrics', 'Lyrics') : mainToolbarLabel('Multitrack', 'Mix')}
      </button>
    );
  };

  const renderBpmSig = () => (
    <div className="flex flex-col items-center gap-0 px-1" onClick={() => setShowMetronomeSettings(true)}>
      <div className="flex items-center gap-1 leading-tight">
        <span className="text-[9px] font-bold text-zinc-500 uppercase">BPM</span>
        <span className="text-[9px] font-mono font-bold text-zinc-300">{bpm}</span>
      </div>
      <span className="text-[9px] font-mono font-bold text-zinc-300 leading-tight">{timeSignature[0]}/{timeSignature[1]}</span>
    </div>
  );

  const renderMetronomeBtn = () => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const metronome = useStore.getState().tracks.find(t => t.id === 'metronome');
        if (metronome) updateTrack('metronome', { isMuted: !metronome.isMuted });
      }}
      className={cn(
        toolbarBtn(true),
        tracks.find(t => t.id === 'metronome')?.isMuted
          ? "text-zinc-400 hover:text-zinc-400 hover:bg-zinc-800"
          : "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
      )}
      title="Toggle Metronome"
    >
      <Metronome size={headerIconSize} />
    </button>
  );

  const renderPreRollBtn = () => (
    <button
      onClick={() => {
        const modes = ['always', 'recording', 'none'] as const;
        const nextMode = modes[(modes.indexOf(preRollMode) + 1) % modes.length];
        setPreRollMode(nextMode);
      }}
      className={cn(btnClassBase, "flex items-stretch gap-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 whitespace-nowrap")}
      title={`Count-in: ${preRollMode}`}
    >
      <div className="flex flex-col items-end justify-center shrink-0 leading-none">
        <span className="text-[8px] font-bold">Pre</span>
        <span className="text-[8px] font-bold">Roll</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[9px] font-bold">{preRollMode === 'none' ? 'None' : preRollMode === 'recording' ? 'Only Rec' : 'Always'}</span>
      </div>
    </button>
  );

  const renderTransport = () => (
    <>
      <button onClick={() => seekTo(0)} className={cn(toolbarBtn(true, "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full"))}><Rewind size={headerIconSize} /></button>
      <button onClick={handleStop} className={cn(toolbarBtn(true, "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full"))}><Square size={headerIconSize} fill="currentColor" /></button>
      <button onClick={handlePlayPause} className={cn(toolbarBtn(), `w-[${playBtnPx}px] h-[${playBtnPx}px]`, "rounded-full shadow-lg", isPlaying ? "bg-zinc-100 text-zinc-900 hover:bg-white" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700")}>
        {isPlaying ? <Pause size={playIconPx} fill="currentColor" /> : <Play size={playIconPx} className="ml-0.5" fill="currentColor" />}
      </button>
      <button onClick={() => seekTo(useStore.getState().currentTime + 10)} className={cn(toolbarBtn(true, "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full"))}><FastForward size={headerIconSize} /></button>
    </>
  );

  const renderMoveLockBtn = () => (
    <button onClick={() => setMoveLocked(!moveLocked)} className={cn(toolbarBtn(true), moveLocked ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10")} title={moveLocked ? "Movement Locked" : "Movement Unlocked"}>
      {moveLocked ? <Lock size={headerIconSize} /> : <Unlock size={headerIconSize} />}
    </button>
  );

  const renderEnvLockBtn = () => (
    <button onClick={() => setEnvelopeLocked(!envelopeLocked)} className={cn(toolbarBtn(true), envelopeLocked ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10")} title={envelopeLocked ? "Envelopes Locked" : "Envelopes Unlocked"}>
      <Activity size={headerIconSize} />
    </button>
  );

  const renderCuesBtn = () => (
    <button
      onClick={() => { if (handleCuesClick()) return; setShowCues(v => !v); }}
      onPointerDown={feedbackActivators.onPointerDown}
      onPointerUp={feedbackActivators.onPointerUp}
      onPointerLeave={feedbackActivators.onPointerLeave}
      className={cn(toolbarBtn(true), (showCues || showFeedback) ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800")}
      title="Toggle Cues"
    >
      <ListMusic size={headerIconSize} />
    </button>
  );

  const renderFullscreenBtn = () => (
    <button onClick={toggleFullscreen} className={cn(toolbarBtn(true, "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"))} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
      {isFullscreen ? <Minimize size={headerIconSize} /> : <Maximize size={headerIconSize} />}
    </button>
  );

  const renderTimeDisplay = () => (
    <div className="scale-[0.65]">
      <TransportTimeDisplay />
    </div>
  );

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 overflow-hidden">
      {/* Hidden input for importing project JSON file */}
      <input 
        type="file" 
        accept=".awnn,.json" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileImport} 
      />
      
      {/* Hidden input for importing audio tracks */}
      <input 
        type="file" 
        accept="audio/*"
        multiple
        className="hidden" 
        ref={audioImportInputRef}
        onChange={handleAudioImport}
      />

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
      <header className={cn(
        "border-b border-zinc-800 bg-zinc-900/90 flex shrink-0 z-50 w-full",
        isSmallPortrait ? (isWidePortrait || appMode === 'lyrics' ? "flex-col" : "flex-col min-h-32") : "min-h-10 sm:min-h-12 items-center px-1.5"
      )}>
        {isSmallPortrait ? (
          (isWidePortrait || appMode === 'lyrics') ? (
            /* Wide Portrait: 2-row Layout */
            <div className="flex-1 flex flex-col px-1.5 py-1 gap-1">
              {/* Row 1: left items | transport | right items */}
              <div className="flex items-stretch gap-1 flex-1">
                <div className="flex items-center justify-between flex-[5]">
                  <div className="flex items-center gap-1">
                    {showTier(1) && renderMenuBtn()}
                    {showTier(1) && isWidePortrait && <h1 className="font-semibold text-xs tracking-wide shrink-0">AWNN</h1>}
                  </div>
                  {showTier(1) && renderAppModeBtn()}
                </div>
                <div className="flex-[5] flex items-center justify-center">
                  {renderTransport()}
                </div>
                <div className="flex-[3] flex items-center justify-end gap-2">
                  {showTier(2) && renderCuesBtn()}
                  {showTier(2) && renderFullscreenBtn()}
                </div>
              </div>
              {/* Row 2: metro+bpm+preroll | time display | locks */}
              <div className="flex items-stretch gap-1 flex-1">
                <div className="flex items-center justify-between flex-[5]">
                    {showTier(1) && renderMetronomeBtn()}
                    {showTier(1) && renderBpmSig()}
                  {showTier(1) && renderPreRollBtn()}
                </div>
                <div className="flex-[5] flex items-center justify-center">
                  {showTier(2) && renderTimeDisplay()}
                </div>
                <div className="flex-[3] flex items-center justify-end gap-2">
                  {showTier(2) && appMode === 'mixer' && (
                    <>
                      {renderMoveLockBtn()}
                      {renderEnvLockBtn()}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Small Portrait: 3-Column Layout */
            <div className="flex-1 flex items-stretch">
              {/* Left Column: Menu+AppMode | Pre-Roll | Metronome+BPM/Sig */}
            <div className="flex flex-col justify-between py-1 px-1.5 gap-0.5">
              <div className="flex items-center justify-between">
                {showTier(1) && renderMenuBtn()}
                {showTier(1) && renderAppModeBtn()}
              </div>
              <div className="flex items-center">
                {showTier(1) && renderPreRollBtn()}
              </div>
              <div className="flex items-center justify-between">
                {showTier(1) && renderMetronomeBtn()}
                {showTier(1) && renderBpmSig()}
              </div>
            </div>

            {/* Center Column: Transport */}
            <div className="flex-1 flex flex-col items-center px-1">
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-1">
                  {renderTransport()}
                </div>
              </div>
              {showTier(2) && renderTimeDisplay()}
            </div>

            {/* Right Column: Cues+FS top, Locks bottom */}
            <div className="flex flex-col justify-between py-1 px-1.5 gap-0.5">
              <div className="flex items-center justify-between">
                {showTier(2) && renderCuesBtn()}
                {showTier(2) && renderFullscreenBtn()}
              </div>
              <div className="flex items-center justify-between">
                {showTier(2) && appMode === 'mixer' && (
                  <>
                    {renderMoveLockBtn()}
                    {renderEnvLockBtn()}
                  </>
                )}
              </div>
            </div>
          </div>
          )
        ) : (
          /* Normal Layout (landscape/medium/large) */
          <>
            {/* Left: App Controls */}
            <div className="flex-1 flex items-center gap-0.5 sm:gap-1.5 justify-start overflow-hidden">
              {showTier(1) && renderMenuBtn()}
              {showTier(1) && renderAppModeBtn()}
              {showTier(1) && renderBpmSig()}
              {showTier(1) && renderMetronomeBtn()}
            </div>
            
            {/* Center: Transport Controls */}
            <div className="flex-1 flex justify-center items-center gap-1 sm:gap-3">
              <div className="flex items-center gap-0.5 sm:gap-2">
                {renderTransport()}
              </div>
            </div>

            {/* Right: View Toggles */}
            <div className="flex-1 flex items-center gap-0.5 sm:gap-1 justify-end overflow-hidden">
              {showTier(1) && renderPreRollBtn()}
              {showTier(2) && appMode === 'mixer' && (
                <>
                  {renderMoveLockBtn()}
                  {renderEnvLockBtn()}
                </>
              )}
              {showTier(2) && renderCuesBtn()}
              {showTier(2) && renderFullscreenBtn()}
            </div>
          </>
        )}
      </header>

      {/* Logo Menu Modal */}
      <ModalShell show={showLogoMenu} onClose={() => setShowLogoMenu(false)} title="Menu">
        <div className="space-y-1">
          <button onClick={() => { exportProject(useStore.getState()); setShowLogoMenu(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors">
            <Save size={16} /> Save Song
          </button>
          <button onClick={() => { fileInputRef.current?.click(); setShowLogoMenu(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors">
            <FolderOpen size={16} /> Load Song
          </button>
          <div className="h-px bg-zinc-800 mx-2" />
          <button onClick={() => { audioImportInputRef.current?.click(); setShowLogoMenu(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors">
            <Upload size={16} /> Import Audio Tracks
          </button>
          <div className="h-px bg-zinc-800 mx-2" />
          <button onClick={() => { setShowSettings(true); setShowLogoMenu(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors">
            <Settings size={16} /> Settings
          </button>
        </div>
      </ModalShell>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden relative">
        
        {/* TrackBar - persistent left sidebar, shared across modes */}
        <TrackBar mode={appMode === 'lyrics' ? 'lyrics' : 'mixer'} handlers={{
          handleTrackPointerDown,
          handleTrackPointerUp,
          handleTrackPointerLeave,
          handleRecord,
          handleMutePointerDown,
          handleMutePointerUp,
          handleUndoRecording: undoLastRecording,
        }} />
        
        {/* Right panel — waveforms always rendered (keeps engine alive), LyricsBuilder overlays */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          
          {/* Waveforms — always in the DOM, visually hidden in lyrics mode */}
          <div className={cn(
            "flex-1 flex flex-row overflow-hidden transition-opacity duration-150",
            appMode === 'lyrics' && 'opacity-0 pointer-events-none'
          )}>
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
                className="w-full multitrack-container timeline-container relative z-20 touch-none overscroll-none" 
                onClickCapture={handleContainerClick}
              />
              {isReady && <TimelineGrid />}
              {isReady && <SyncTool />}
              {isReady && <EnvelopeEditor />}
            </section>
            
            {/* Right Sidebar - Feedback Panel or Cues List */}
            <FeedbackChatPanel show={showFeedback} onClose={() => setShowFeedback(false)} />
            <SidebarPanel show={!showFeedback && showCues} title="Cues" headerRight={
              <button 
                onClick={() => addCue({ time: useStore.getState().currentTime, label: `Cue ${cues.length + 1}` })}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors"
                title="Add Cue"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            }>
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
            </SidebarPanel>
          </div>

          {/* Lyrics — absolutely positioned over waveforms */}
          {appMode === 'lyrics' && (
            <div className="absolute inset-0 z-10 bg-zinc-950">
              <LyricsBuilder startRecording={startRecording} stopRecording={stopRecording} />
            </div>
          )}
        </div>

      </main>

      <ModalShell show={showAdvancedSettings} onClose={() => setShowAdvancedSettings(false)} title="Advanced Settings">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
            Microphone Capture
          </label>
          <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-zinc-800/50">
            <div className="pr-4">
              <div className="text-sm font-bold text-zinc-100">Raw Capture</div>
              <div className="text-[10px] text-zinc-500 mt-1 leading-tight">Disables browser echo cancellation, noise suppression, and AGC. Allows for lower latency, but requires headphones to avoid feedback.</div>
            </div>
            <button 
              onClick={() => useStore.getState().setRawRecordingMode(!useStore.getState().rawRecordingMode)}
              className={cn("w-10 h-6 rounded-full relative transition-colors shrink-0", useStore.getState().rawRecordingMode ? "bg-green-500" : "bg-zinc-700")}
            >
              <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-transform", useStore.getState().rawRecordingMode ? "left-5" : "left-1")} />
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-zinc-800/50 mt-2">
            <div className="pr-4 flex-1 min-w-0">
              <div className="text-sm font-bold text-zinc-100">Head Length</div>
              <div className="text-[10px] text-zinc-500 mt-1 leading-tight">Rolling buffer head duration before punch-in. New clips use this value.</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-xs text-zinc-300 w-14 text-right tabular-nums">{useStore.getState().headLength.toFixed(3)}s</span>
              <input 
                type="range" 
                min="0" max="1" step="0.001"
                value={useStore.getState().headLength}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) useStore.getState().setHeadLength(val);
                }}
                className="w-24 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
            Diagnostics
          </label>
          <span className="block text-[10px] text-zinc-600 leading-snug">
            Calibration is now done through the visual calibration tool in Settings → Calibration.
          </span>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
            Button Sizes (CSS px)
          </label>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-zinc-800/50">
              <span className="text-xs text-zinc-300">Small Screen</span>
              <input 
                type="number" 
                min="24" max="48" step="1"
                value={smallBtnSize}
                onChange={(e) => setSmallBtnSize(parseInt(e.target.value) || 36)}
                className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 text-center"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-zinc-800/50">
              <span className="text-xs text-zinc-300">Medium Screen</span>
              <input 
                type="number" 
                min="32" max="56" step="1"
                value={mediumBtnSize}
                onChange={(e) => setMediumBtnSize(parseInt(e.target.value) || 44)}
                className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 text-center"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-zinc-800/50">
              <span className="text-xs text-zinc-300">Large Screen</span>
              <input 
                type="number" 
                min="40" max="64" step="1"
                value={largeBtnSize}
                onChange={(e) => setLargeBtnSize(parseInt(e.target.value) || 52)}
                className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 text-center"
              />
            </div>
          </div>
        </div>

        {/* Dangerous Settings */}
        <div className="border-t border-red-900/30 pt-4">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-red-500 mb-2">
            Dangerous Settings
          </label>
          <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-red-900/30">
            <div className="pr-4">
              <div className="text-sm font-bold text-zinc-100">Startup Delay</div>
              <div className="text-[10px] text-zinc-500 mt-1 leading-tight">Estimated time (ms) between play start and actual audio context running. Higher = safer but slower.</div>
            </div>
            <input 
              type="number" 
              min="0" max="1000" step="10"
              value={useStore.getState().startupDelayMs}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) useStore.getState().setStartupDelayMs(val);
              }}
              className="w-16 bg-zinc-800 border border-red-900/50 rounded px-2 py-1 text-xs text-zinc-100 text-right"
            />
          </div>
          <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded border border-red-900/30 mt-2">
            <div className="pr-4">
              <div className="text-sm font-bold text-zinc-100">Buffer Safety</div>
              <div className="text-[10px] text-zinc-500 mt-1 leading-tight">Extra wait (ms) after headLength to ensure rolling buffer is populated before recording starts.</div>
            </div>
            <input 
              type="number" 
              min="0" max="500" step="10"
              value={useStore.getState().bufferSafetyMs}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) useStore.getState().setBufferSafetyMs(val);
              }}
              className="w-16 bg-zinc-800 border border-red-900/50 rounded px-2 py-1 text-xs text-zinc-100 text-right"
            />
          </div>
        </div>

        {/* Reset to Defaults */}
        <button
          onClick={() => {
            if (window.confirm('Reset all settings to defaults? This will not affect your tracks, recordings, or calibration data.')) {
              useStore.getState().resetSettings();
            }
          }}
          className="w-full py-3 bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 rounded text-[10px] font-bold uppercase tracking-wider transition-all border border-red-900/30 mt-4"
        >
          Reset to Defaults
        </button>
      </ModalShell>

      {/* Device Change Notification */}
      <DeviceChangeBanner onOpenCalibration={() => setShowCalibration(true)} />

      {/* Calibration Modal */}
      <VisualCalibrationModal show={showCalibration} onClose={() => setShowCalibration(false)} />

      {/* Settings Modal */}
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenAdvanced={() => { setShowSettings(false); setShowAdvancedSettings(true); }}
        onOpenTracks={() => { setShowSettings(false); setShowTracksModal(true); }}
      />

      {/* Advanced Settings Modal */}
      {/* Tracks Modal */}
      <TrackManagerModal show={showTracksModal} onClose={() => setShowTracksModal(false)} />

      {/* Metronome Settings Modal */}
      <MetronomeModal show={showMetronomeSettings} onClose={() => setShowMetronomeSettings(false)} />

      {/* Track Edit Modal */}
      <ModalShell show={!!editingTrackId} onClose={() => setEditingTrackId(null)} title="Track Settings" singleColumn>
        {(() => {
          const track = tracks.find(t => t.id === editingTrackId);
          if (!track) return null;
          return (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Volume</label>
                <div className="flex items-center gap-4">
                  <Volume2 className="w-4 h-4 text-zinc-500" />
                  <input type="range" min="0" max="1" step="0.01" value={track.volume}
                    onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
                    className="flex-1 h-3 bg-zinc-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-zinc-100 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-zinc-400"
                  />
                  <span className="font-mono text-xs w-8 text-right">{Math.round(track.volume * 100)}%</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Offset (seconds)</label>
                <div className="flex items-center gap-4">
                  <input type="range" min="-1" max="1" step="0.01" value={track.offset || 0}
                    onChange={(e) => updateTrack(track.id, { offset: parseFloat(e.target.value) })}
                    className="flex-1 h-3 bg-zinc-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-zinc-100 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-zinc-400"
                  />
                  <span className="font-mono text-xs w-10 text-right">{(track.offset || 0).toFixed(2)}s</span>
                </div>
              </div>
              <div className="pt-4 border-t border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Track Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={track.color}
                      onChange={(e) => updateTrack(track.id, { color: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer border-none bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">{track.color}</span>
                  </div>
                </div>
                <input type="file" accept="audio/*" className="hidden" ref={audioInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    perfLogger.log(10, file.name);
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      perfLogger.log(13);
                      const arrayBuffer = event.target?.result as ArrayBuffer;
                      const audioContext = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
                      try {
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
                        const url = URL.createObjectURL(file);
                        const peaks = await calculatePeaksAsync(audioBuffer);
                        useStore.getState().addPhrase(track.id, {
                          url, blob: file, audioBuffer, peaks,
                          startPosition: useStore.getState().currentTime,
                          duration: audioBuffer.duration,
                          headLength: useStore.getState().headLength,
                          anchoredFrame: 0, originalAnchoredFrame: 0,
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
                <button onClick={() => audioInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm font-medium transition-colors">
                  <Upload className="w-4 h-4" /> Import Audio
                </button>
                <button onClick={() => { fileInputRef.current?.click(); setEditingTrackId(null); }}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm font-medium transition-colors">
                  <Music className="w-4 h-4" /> Import MIDI
                </button>
              </div>
            </div>
          );
        })()}
      </ModalShell>
      {/* Import Audio Modal */}
      <ImportAudioModal show={showImportModal} onClose={() => setShowImportModal(false)} files={importFiles} />

      {/* Confirmation Modal for BPM/SIG changes */}
      <ModalShell show={!!pendingChange} onClose={() => setPendingChange(null)} title="Confirm Project Change" singleColumn>
        <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
          Changing the {pendingChange?.type === 'bpm' ? 'BPM' : 'Time Signature'} will alter the grid and click track, but will NOT stretch existing audio clips. This may cause misalignment.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setPendingChange(null)}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors text-sm font-medium">
            Cancel
          </button>
          <button onClick={() => {
            if (pendingChange?.type === 'bpm') {
              setBpm(pendingChange.value as number);
            } else {
              setTimeSignature(pendingChange.value as [number, number]);
            }
            setPendingChange(null);
          }}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-sm font-medium shadow-lg shadow-emerald-900/20">
            Proceed
          </button>
        </div>
      </ModalShell>

    </div>
  );
}

