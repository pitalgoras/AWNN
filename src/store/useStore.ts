import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mutative } from 'zustand-mutative';
import localforage from 'localforage';

export interface Phrase {
  id: string;
  url: string;
  blob?: Blob;
  audioBuffer?: AudioBuffer;
  peaks?: number[][]; // Pre-calculated peaks for WaveSurfer
  startPosition: number;
  originalStartPosition?: number;
  headLength: number; // Head length used when this clip was recorded
  anchoredFrame?: number; // Frame offset from UserTime 0 (ground truth)
  originalAnchoredFrame?: number; // Original anchor for Reset/Undo
  duration: number;
  startCue?: number;
  endCue?: number;
  createdAt: number;
  name?: string;
}

export interface EnvelopeNode {
  id: string;
  time: number;
  value: number; // 0 to 1
}

export interface Track {
  id: string;
  name: string;
  color: string;
  isMuted: boolean;
  isSolo: boolean;
  volume: number;
  pan: number;
  offset: number; // Latency compensation / manual nudge in seconds
  anchoredFrame?: number; // NEW: Frame offset from UserTime 0 (for stable sync)
  phrases: Phrase[];
  envelope: EnvelopeNode[];
}

export interface Cue {
  id: string;
  time: number;
  label: string;
}

interface ProjectData {
  tracks: Track[];
  cues: Cue[];
  bpm: number;
  timeSignature: [number, number];
  globalLatencyMs: number;
}

export interface VoicingSegment {
  id: string;
  startChar: number;
  endChar: number;
  colorId: string;
}

interface AppState {
  appMode: 'mixer' | 'lyrics';
  lyricsText: string;
  lyricsSegments: VoicingSegment[];
  lyricsViewMode: 'fixed' | 'scaled';
  activeColorId: string;
  
  // Configurable button sizes (CSS pixels, editable in Advanced Settings)
  smallBtnSize: number;
  mediumBtnSize: number;
  largeBtnSize: number;
  
  tracks: Track[];
  cues: Cue[];
  bpm: number;
  timeSignature: [number, number]; // e.g. [4, 4]
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  duration: number;
  zoom: number;
  globalLatencyMs: number;
  extraLatencyMs: number;
  selectedTrackId: string | null;
  selectedPhraseId: string | null;
  syncLoop: { start: number, end: number } | null;
  moveLocked: boolean;
  envelopeLocked: boolean;
  rawRecordingMode: boolean;
  headLength: number; // Rolling buffer head length in seconds (0-1)
  sampleRate: number; // AudioContext sample rate for anchor calculations
  startupDelayMs: number; // Estimated ms between onSetIsPlaying and actual playback start (dangerous)
  bufferSafetyMs: number; // Extra ms wait before START_RECORDING to ensure buffer is populated (dangerous)
  minProjectDurationMs: number; // Minimum project duration in ms (playback won't stop before this)
  metronomeEnabled: boolean; // Master metronome toggle (default true)
  barLinesEnabled: 'none' | 'bars-beats' | 'bars-only'; // Show vertical bar/beat lines (default bars-beats)
  metronomeTrackVisible: boolean; // Show metronome waveform strip (default true)
  preRollMode: 'always' | 'recording' | 'none';
  waveformQuality: 'low' | 'medium' | 'high';
  isReady: boolean;
  
  // Responsive Layout State
  trackHeight: number;
  metronomeHeight: number;
  sidebarWidth: number;
  toolbarProposal: 1 | 2 | 3;
  toolbarVisibleLabels: boolean;
  
  // Actions
  addTrack: (track: Omit<Track, 'id'>) => void;
  updateTrack: (id: string, updates: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  
  addPhrase: (trackId: string, phrase: Omit<Phrase, 'id'>) => void;
  updatePhrase: (trackId: string, phraseId: string, updates: Partial<Phrase>) => void;
  updatePhrasePosition: (trackId: string, phraseId: string, position: number) => void;
  shiftAllPhrases: (amount: number, exceptPhraseId?: string) => void;
  removePhrase: (trackId: string, phraseId: string) => void;
  
  addCue: (cue: Omit<Cue, 'id'>) => void;
  updateCue: (id: string, updates: Partial<Cue>) => void;
  removeCue: (id: string) => void;
  
  addEnvelopeNode: (trackId: string, node: Partial<EnvelopeNode> & { time: number, value: number }) => void;
  updateEnvelopeNode: (trackId: string, nodeId: string, updates: Partial<EnvelopeNode>) => void;
  removeEnvelopeNode: (trackId: string, nodeId: string) => void;
  
  setBpm: (bpm: number) => void;
  setTimeSignature: (sig: [number, number]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsRecording: (isRecording: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setZoom: (zoom: number) => void;
  setGlobalLatencyMs: (ms: number) => void;
  setExtraLatencyMs: (ms: number) => void;
  setSelectedTrackId: (id: string | null) => void;
  setSelectedPhraseId: (id: string | null) => void;
  setSyncLoop: (loop: { start: number, end: number } | null) => void;
  setMoveLocked: (locked: boolean) => void;
  setEnvelopeLocked: (locked: boolean) => void;
  setRawRecordingMode: (mode: boolean) => void;
  setHeadLength: (length: number) => void;
  setStartupDelayMs: (ms: number) => void;
  setBufferSafetyMs: (ms: number) => void;
  setMinProjectDurationMs: (ms: number) => void;
  setMetronomeEnabled: (v: boolean) => void;
  setBarLinesEnabled: (v: 'none' | 'bars-beats' | 'bars-only') => void;
  cycleBarLines: () => void;
  setMetronomeTrackVisible: (v: boolean) => void;
  setPreRollMode: (mode: 'always' | 'recording' | 'none') => void;
  setWaveformQuality: (quality: 'low' | 'medium' | 'high') => void;
  setIsReady: (isReady: boolean) => void;
  setResponsiveLayout: (layout: { trackHeight: number, metronomeHeight: number, sidebarWidth: number }) => void;
  setSampleRate: (rate: number) => void;
  setToolbarProposal: (proposal: 1 | 2 | 3) => void;
  setToolbarVisibleLabels: (visible: boolean) => void;
  reorderTracks: (startIndex: number, endIndex: number) => void;
  resetSettings: () => void;
  
  setSmallBtnSize: (size: number) => void;
  setMediumBtnSize: (size: number) => void;
  setLargeBtnSize: (size: number) => void;
  
  setAppMode: (mode: 'mixer' | 'lyrics') => void;
  setLyricsText: (text: string) => void;
  setLyricsSegments: (segments: VoicingSegment[]) => void;
  setLyricsViewMode: (mode: 'fixed' | 'scaled') => void;
  setActiveColorId: (colorId: string) => void;

  getMultitrackTime: () => number;
  setMultitrackTimeGetter: (getter: () => number) => void;
  seekTo?: (time: number) => void;
  setSeekTo: (fn: (time: number) => void) => void;

  saveProject: () => Promise<void>;
  loadProject: () => Promise<void>;
}

const defaultSettings = {
  bpm: 120,
  timeSignature: [4, 4] as [number, number],
  zoom: 10,
  globalLatencyMs: 0,
  extraLatencyMs: 0,
  moveLocked: true,
  envelopeLocked: true,
  rawRecordingMode: true,
  headLength: 0.5, // Default 500ms rolling buffer head
  startupDelayMs: 150, // Default 150ms estimated startup latency (dangerous setting)
  bufferSafetyMs: 100, // Default 100ms buffer safety margin (dangerous setting)
  minProjectDurationMs: 600000, // Default 600s minimum project duration (dangerous setting)
  metronomeEnabled: true,
  barLinesEnabled: 'bars-beats' as const,
  metronomeTrackVisible: true,
  preRollMode: 'always' as const,
  waveformQuality: 'low' as const,
  isReady: false,
  trackHeight: 80,
  metronomeHeight: 60,
  sidebarWidth: 300,
  toolbarProposal: 1 as const,
  toolbarVisibleLabels: true,
  appMode: 'mixer' as const,
  lyricsText: '',
  lyricsSegments: [] as VoicingSegment[],
  lyricsViewMode: 'fixed' as const,
  activeColorId: '#FACC15', // Default unison color
  sampleRate: 44100, // Default; updated when AudioContext is created
  // Configurable button sizes (CSS pixels)
  smallBtnSize: 36,
  mediumBtnSize: 44,
  largeBtnSize: 52,
};

export const useStore = create<AppState>()(
  persist(
    mutative(
      (set, get) => ({
        tracks: [
          { id: 'metronome', name: 'Metronome', color: '#718096', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
          { id: '1', name: 'Instruments', color: '#4a5568', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
          { id: '2', name: 'Sopranos', color: '#F6E05E', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
          { id: '3', name: 'Altos', color: '#F56565', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
          { id: '4', name: 'Tenors', color: '#48BB78', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
          { id: '5', name: 'Basses', color: '#4299E1', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
        ],
        cues: [],
        ...defaultSettings,
        isPlaying: false,
        isRecording: false,
        currentTime: 0,
        duration: 0,
        selectedTrackId: null,
        selectedPhraseId: null,
        syncLoop: null,

        setAppMode: (mode) => set({ appMode: mode }),
        setLyricsText: (text) => set({ lyricsText: text }),
        setLyricsSegments: (segments) => set({ lyricsSegments: segments }),
        setLyricsViewMode: (mode) => set({ lyricsViewMode: mode }),
        setActiveColorId: (colorId) => set({ activeColorId: colorId }),

        setMoveLocked: (locked) => set({ moveLocked: locked }),
        setEnvelopeLocked: (locked) => set({ envelopeLocked: locked }),
        setRawRecordingMode: (mode) => set({ rawRecordingMode: mode }),
        setHeadLength: (length) => set({ headLength: Math.max(0, Math.min(1, length)) }),
        setStartupDelayMs: (ms) => set({ startupDelayMs: Math.max(0, Math.min(1000, ms)) }),
        setBufferSafetyMs: (ms) => set({ bufferSafetyMs: Math.max(0, Math.min(500, ms)) }),
        setMinProjectDurationMs: (ms) => set({ minProjectDurationMs: Math.max(10000, Math.min(3600000, ms)) }),
        setMetronomeEnabled: (v) => set((state) => {
          state.metronomeEnabled = v;
          if (v) {
            state.barLinesEnabled = 'bars-beats';
            state.metronomeTrackVisible = true;
          } else {
            state.barLinesEnabled = 'none';
            state.metronomeTrackVisible = false;
          }
        }),
        setBarLinesEnabled: (v) => set({ barLinesEnabled: v }),
        cycleBarLines: () => set((state) => {
          const order = ['none', 'bars-beats', 'bars-only'] as const;
          const idx = order.indexOf(state.barLinesEnabled);
          state.barLinesEnabled = order[(idx + 1) % 3];
        }),
        setMetronomeTrackVisible: (v) => set({ metronomeTrackVisible: v }),
        setSampleRate: (rate) => set({ sampleRate: rate }),
        setPreRollMode: (mode) => set({ preRollMode: mode }),
        setWaveformQuality: (quality) => set({ waveformQuality: quality }),
        setIsReady: (isReady) => set({ isReady }),
        setResponsiveLayout: (layout) => set(layout),
        setToolbarProposal: (toolbarProposal) => set({ toolbarProposal }),
        setToolbarVisibleLabels: (toolbarVisibleLabels) => set({ toolbarVisibleLabels }),
        reorderTracks: (startIndex, endIndex) => set((state) => {
          const [removed] = state.tracks.splice(startIndex, 1);
          state.tracks.splice(endIndex, 0, removed);
        }),
        resetSettings: () => set({ ...defaultSettings }),
        
        addTrack: (track) => set((state) => {
          state.tracks.push({ ...track, id: Math.random().toString(36).substr(2, 9) });
        }),
        updateTrack: (id, updates) => set((state) => {
          const track = state.tracks.find(t => t.id === id);
          if (track) Object.assign(track, updates);
        }),
        removeTrack: (id) => set((state) => {
          state.tracks = state.tracks.filter(t => t.id !== id);
        }),
        
        addPhrase: (trackId, phrase) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (track) {
            const takeNumber = track.phrases.length + 1;
            const newPhrase = { 
              ...phrase, 
              id: Math.random().toString(36).substr(2, 9),
              name: `Take ${takeNumber}`
            };
            track.phrases.push(newPhrase);
            // FIXED: Update track.anchoredFrame so multitrack can use it
            if (newPhrase.anchoredFrame !== undefined) {
              track.anchoredFrame = newPhrase.anchoredFrame;
              console.log('store: set track.anchoredFrame =', newPhrase.anchoredFrame, 'for track', trackId);
            } else if (phrase.anchoredFrame !== undefined) {
              track.anchoredFrame = phrase.anchoredFrame;
              console.log('store: set track.anchoredFrame =', phrase.anchoredFrame, 'for track', trackId, '(from phrase)');
            }
          }
        }),
        updatePhrase: (trackId, phraseId, updates) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (track) {
            const phrase = track.phrases.find(p => p.id === phraseId);
            if (phrase) Object.assign(phrase, updates);
          }
        }),
        updatePhrasePosition: (trackId, phraseId, position) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (!track) return;
          
          const phrase = track.phrases.find(p => p.id === phraseId);
          if (!phrase) return;
          
          const oldPosition = phrase.startPosition;
          const newPosition = Math.max(0, position);
          const delta = newPosition - oldPosition;
          
          if (Math.abs(delta) < 0.0001) return;

          phrase.startPosition = newPosition;
          // FIXED: Recalculate anchoredFrame relative to new position to preserve sync
          // anchoredFrame represents the frame offset from UserTime 0
          // When the clip moves, we need to update anchoredFrame so audio still lines up
          // new anchoredFrame = originalAnchoredFrame + (newPosition - originalStartPosition) * sampleRate
          // But since we want relative shift: deltaFrames = deltaPosition * sampleRate
          if (phrase.originalAnchoredFrame !== undefined && phrase.originalAnchoredFrame !== 0) {
            const sampleRate = get().sampleRate || 44100;
            const deltaFrames = Math.round(delta * sampleRate);
            phrase.anchoredFrame = phrase.originalAnchoredFrame + deltaFrames;
            console.log('store: updated anchoredFrame for moved phrase:', phrase.anchoredFrame, '(delta:', delta, ')');
          }
          // Shift envelope nodes that are within the phrase's time range
          track.envelope.forEach(node => {
            if (node.time >= oldPosition - 0.01 && node.time <= oldPosition + phrase.duration + 0.01) {
              node.time = Math.max(0, node.time + delta);
            }
          });
        }),
        shiftAllPhrases: (amount, exceptPhraseId) => set((state) => {
          state.tracks.forEach(t => {
            t.phrases.forEach(p => {
              if (p.id !== exceptPhraseId) {
                p.startPosition = Math.max(0, p.startPosition + amount);
              }
            });
          });
        }),
        removePhrase: (trackId, phraseId) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (track) {
            track.phrases = track.phrases.filter(p => p.id !== phraseId);
          }
        }),
        
        addCue: (cue) => set((state) => {
          state.cues.push({ ...cue, id: Math.random().toString(36).substr(2, 9) });
          state.cues.sort((a, b) => a.time - b.time);
        }),
        updateCue: (id, updates) => set((state) => {
          const cue = state.cues.find(c => c.id === id);
          if (cue) Object.assign(cue, updates);
          state.cues.sort((a, b) => a.time - b.time);
        }),
        removeCue: (id) => set((state) => {
          state.cues = state.cues.filter(c => c.id !== id);
        }),
        
        addEnvelopeNode: (trackId, node) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (track) {
            track.envelope.push({ ...node, id: node.id || Math.random().toString(36).substr(2, 9) } as EnvelopeNode);
            track.envelope.sort((a, b) => a.time - b.time);
          }
        }),
        updateEnvelopeNode: (trackId, nodeId, updates) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (track) {
            const node = track.envelope.find(n => n.id === nodeId);
            if (node) Object.assign(node, updates);
            track.envelope.sort((a, b) => a.time - b.time);
          }
        }),
        removeEnvelopeNode: (trackId, nodeId) => set((state) => {
          const track = state.tracks.find(t => t.id === trackId);
          if (track) {
            track.envelope = track.envelope.filter(n => n.id !== nodeId);
          }
        }),
        
        setBpm: (bpm) => set({ bpm }),
        setTimeSignature: (timeSignature) => set({ timeSignature }),
        setIsPlaying: (isPlaying) => set({ isPlaying }),
        setIsRecording: (isRecording) => set({ isRecording }),
        setCurrentTime: (currentTime) => set({ currentTime }),
        setDuration: (duration) => set({ duration }),
        setZoom: (zoom) => set({ zoom }),
        setGlobalLatencyMs: (globalLatencyMs) => set({ globalLatencyMs }),
        setExtraLatencyMs: (extraLatencyMs) => set({ extraLatencyMs }),
        setSelectedTrackId: (selectedTrackId) => set({ selectedTrackId }),
        setSelectedPhraseId: (selectedPhraseId) => set({ selectedPhraseId }),
        setSyncLoop: (syncLoop) => set({ syncLoop }),
        
        setSmallBtnSize: (size) => set({ smallBtnSize: size }),
        setMediumBtnSize: (size) => set({ mediumBtnSize: size }),
        setLargeBtnSize: (size) => set({ largeBtnSize: size }),
        
        getMultitrackTime: () => 0,
        setMultitrackTimeGetter: (getter) => set({ getMultitrackTime: getter }),
        seekTo: undefined,
        setSeekTo: (fn) => set({ seekTo: fn }),

        saveProject: async () => {
          const state = get();
          const projectData = {
            tracks: state.tracks,
            cues: state.cues,
            bpm: state.bpm,
            timeSignature: state.timeSignature,
            globalLatencyMs: state.globalLatencyMs,
          };
          try {
            await localforage.setItem('awnn_project', projectData);
            alert('Project saved successfully!');
          } catch (err) {
            console.error('Error saving project:', err);
            alert('Failed to save project.');
          }
        },

        loadProject: async () => {
          try {
            const projectData = await localforage.getItem<ProjectData>('awnn_project');
            if (projectData) {
              // Recreate object URLs for blobs
              const tracksWithUrls = projectData.tracks.map((t: Track) => {
                const updatedPhrases = t.phrases?.map((p, index) => {
                  if (p.blob) {
                    return { 
                      ...p, 
                      url: URL.createObjectURL(p.blob),
                      name: p.name || `Take ${index + 1}`
                    };
                  }
                  return {
                    ...p,
                    name: p.name || `Take ${index + 1}`
                  };
                }) || [];
                return { ...t, phrases: updatedPhrases };
              });

              // Ensure metronome track exists
              let finalTracks = tracksWithUrls;
              if (!finalTracks.some((t: Track) => t.id === 'metronome')) {
                finalTracks = [
                  { id: 'metronome', name: 'Metronome', color: '#718096', isMuted: false, isSolo: false, volume: 1, pan: 0, offset: 0, phrases: [], envelope: [] },
                  ...finalTracks
                ];
              }

              set((state) => {
                state.tracks = finalTracks;
                state.cues = projectData.cues || [];
                state.bpm = projectData.bpm || 120;
                state.timeSignature = projectData.timeSignature || [4, 4];
                state.globalLatencyMs = projectData.globalLatencyMs || 0;
              });
              alert('Project loaded successfully!');
            } else {
              alert('No saved project found.');
            }
          } catch (err) {
            console.error('Error loading project:', err);
            alert('Failed to load project.');
          }
        },
      })
    ),
    {
      name: 'awnn-settings',
      partialize: (state) => ({
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        zoom: state.zoom,
        globalLatencyMs: state.globalLatencyMs,
        moveLocked: state.moveLocked,
        envelopeLocked: state.envelopeLocked,
        rawRecordingMode: state.rawRecordingMode,
        preRollMode: state.preRollMode,
        waveformQuality: state.waveformQuality,
        appMode: state.appMode,
        lyricsText: state.lyricsText,
        lyricsSegments: state.lyricsSegments,
        lyricsViewMode: state.lyricsViewMode,
        activeColorId: state.activeColorId,
        toolbarProposal: state.toolbarProposal,
        toolbarVisibleLabels: state.toolbarVisibleLabels,
      }),
    }
  )
);
