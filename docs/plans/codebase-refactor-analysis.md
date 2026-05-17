# Codebase Refactor Analysis

## Overview

AWNN is a web-based multitrack audio recorder and editor (React 19 + TypeScript + Vite + Zustand). This document catalogs areas where modularity and separation of concerns are weakest, prioritizing by impact on low-latency performance and low-powered device support.

---

## Critical Files

### 1. `src/hooks/useAudioEngine.ts` (1157 lines) — Audio God Hook

Mixes every audio concern in one file:

| Concern | Lines | Problem |
|---------|-------|---------|
| WaveSurfer prototype monkey-patching | 13-38 | Global mutation at module boundary |
| CSS injection into `document.head` | 228-324 | Runtime `<style>` element creation per layout change |
| MultiTrack initialization + teardown | 334-506 | Full WaveSurfer recreation on any phrase change |
| rAF `pollTime` loop | 564-702 | Runs every frame even when paused |
| Envelope interpolation (inline math) | 618-638 | Pure function embedded in hot path |
| Volume automation per-track | 606-657 | Iterates all tracks and WaveSurfers every frame |
| Playback state sync | 934-968 | Conditional logic interleaved with audio |
| Zoom sync (throttled) | 906-931 | setTimeout-based throttling |
| Track height DOM updates | 704-741 | Direct WaveSurfer `setOptions` calls |
| Selection region plugin management | 769-859 | Plugin create/find per selection change |
| Position sync | 862-903 | Converts UserTime ↔ RealTime per phrase |
| BPM/time sig debounce | 972-999 | Local state + useEffect pattern |
| Metronome buffer → WAV → Blob → URL | 1002-1065 | Full buffer generation on main thread |
| AudioContext lifecycle | 350-364, 1067-1073 | Inline create/resume/suspend |
| playPause / seekTo / record callbacks | 1067-1143 | Exported API mixed with internals |

**Performance impact on low-powered devices:**
- `pollTime` at vsync rate (60fps) even when paused → wasted CPU/battery
- Envelope interpolation for every track every frame (bounded by track count × envelope nodes)
- Full WaveSurfer recreation on every add/remove phrase — destroys and re-creates all canvas elements
- Metronome buffer generation for long projects blocks main thread
- CSS injection triggers forced style recalc on every layout change

### 2. `src/App.tsx` (1689 lines) — God Component

Mixes everything in one file:

- **6 inline modal dialogs** (Settings, Tracks, Metronome, Track Edit, Advanced, Latency Calibration, Confirmation)
- **Keyboard shortcuts** handler with full event logic
- **Responsive layout math** (track height, sidebar width, breakpoints)
- **File import/export** handlers with Blob/URL logic
- **Direct DOM manipulation** on WaveSurfer wrapper elements
- **Fullscreen API** management

### 3. `src/lib/multitrack/multitrack.ts` (1042 lines) — Monolithic Class

- `initRendering` closure (lines 777-1004) manages all DOM elements and is tightly coupled to MultiTrack
- `initDragging` (lines 1006-1039) is a standalone function intertwined with `onDrag` method
- Direct `this.rendering.containers[0].parentElement` access (line 694)
- Programmatic inline styles on all DOM elements

### 4. `src/store/useStore.ts` (511 lines) — State + Business Logic

Mixes:
- Type definitions (Phrase, Track, Cue, VoicingSegment, AppState)
- Default values (133 lines)
- Business logic: `updatePhrasePosition` (line 317) recalculates anchored frames + shifts envelope nodes
- Persistence: `saveProject`/`loadProject` (lines 422-486) use `localforage` + `URL.createObjectURL` directly

### 5. `src/components/LyricsBuilder.tsx` (750 lines) — Mixed Concerns

- Regex-based lyrics parsing/tokenization (lines 95-142)
- Text cleanup/deduplication rules (lines 144-190)
- Paint bucket voice tag insertion with 8+ branches (lines 193-277)
- Audio recording via `useAudioEngine()` (lines 80-87)
- Full UI rendering (lines 330-748)

---

## Dead Code

| File | Lines | Status |
|------|-------|--------|
| `src/components/AudioEditorView.tsx` | 1134 | Duplicate of App.tsx, **not imported anywhere** |

---

## Hot Path (Performance-Critical)

The `pollTime` rAF loop (`useAudioEngine.ts:564-702`):

```
each animation frame:
  1. multitrack.getCurrentTime() → userTime conversion
  2. State.currentTime update (throttled to ~10Hz)
  3. End-of-project detection
  4. For EACH track:
       a. Volume calculation (mute/solo)
       b. Envelope interpolation (iterate all nodes)
       c. WaveSurfer.setVolume() with change detection
  5. Sync loop enforcement
```

This runs at display refresh rate (typically 60Hz) whenever the component is mounted — regardless of play state.

---

## Existing Good Patterns

| Pattern | Location | Notes |
|---------|----------|-------|
| Sub-store selectors | All components | `useStore(s => s.isPlaying)` — minimizes re-renders |
| Extracted engines | `MetronomeEngine`, `RecordingEngine` | Audio concerns moved out of useAudioEngine recently |
| Small utilities | `audioBufferToWav`, `timeFormat`, `audioUtils` | Focused, testable units |
| Responsive hooks | `useToolbarContext`, `useAdaptiveLabels` | Separate layout from logic |
| Performance path | `pollTime` DOM manipulation | By-passes React reconciliation for cursor |

---

## Suggested Extraction Targets

### From useAudioEngine.ts — in priority order

```
wavesurferPatch.ts         (prototype overrides, module-level side-effect)
AudioContextManager.ts     (create/resume/suspend/close encapsulation)
usePollTime.ts             (rAF loop with idle detection, takes tick callback)
envelopeUtils.ts           (interpolateEnvelope — pure function)
trackItemBuilder.ts        (buildMultitrackItems — pure function)
useTrackLayout.ts          (CSS custom properties + class toggling, replaces adjustLayout)
useDebounce.ts             (shared debounce hook)
metronomePhrases.ts        (buffer generation → phrase objects)
```

### From App.tsx

```
SettingsModal.tsx, TrackManagerModal.tsx, MetronomeModal.tsx, etc.
useKeyboardShortcuts.ts
useFileImport.ts
useFullscreen.ts
```

### From multitrack.ts

```
separate rendering module (DOM creation + styling)
separate dragging module (drag/drop event handling)
```

### From useStore.ts

```
persistence.ts              (saveProject/loadProject → localforage)
storeBusinessLogic.ts       (updatePhrasePosition, addPhrase — anchor frame logic)
```
