# Refactor useAudioEngine (1157-line god hook)

## Motivation

`useAudioEngine.ts` is 1157 lines and mixes audio lifecycle, CSS injection, DOM manipulation, global prototype patching, envelope math, metronome buffer generation, and playback synchronization. This makes it hard to optimize, test, or reason about — especially on low-powered devices where every main-thread cycle matters.

The hot path (`pollTime` rAF loop) runs on every animation frame even when paused, wasting battery/CPU. Pure math (envelope interpolation) is inlined inside the rAF callback. CSS is injected via runtime `<style>` element creation.

## Plan

Three phases, prioritizing performance improvements first.

---

## Phase 1 — Immediate Wins (Performance + Safety)

| # | Change | Lines | File | Impact |
|---|--------|-------|------|--------|
| 1 | Stop rAF loop when idle | 564-702 | `src/hooks/usePollTime.ts` | Saves battery/CPU on pause |
| 2 | Extract envelope interpolation → pure function | 618-638 | `src/audio/processing/envelopeUtils.ts` | Testable, no runtime cost |
| 3 | Move WaveSurfer prototype patching | 13-38 | `src/audio/processing/wavesurferPatch.ts` | Cleaner init, no hot-path impact |
| 4 | Remove dead code | — | Delete `src/components/AudioEditorView.tsx` | -1134 lines, smaller bundle |

### 1a — Idle-aware rAF loop (`usePollTime`)

```typescript
export function usePollTime(
  multitrackRef: RefObject<MultiTrack | null>,
  isActive: boolean,
  onTick: (userTime: number, tracks: Track[]) => void,
  onEnd?: () => void,
)
```

The caller decides what happens each tick. The hook handles rAF lifecycle, idle detection, and cleanup.

### 1b — Envelope interpolation (`envelopeUtils.ts`)

```typescript
export function interpolateEnvelope(
  userTime: number,
  nodes: EnvelopeNode[]
): number
```

Pure function, fully testable.

---

## Phase 2 — Structural Refactors (Organization)

| # | Change | Lines | File |
|---|--------|-------|------|
| 5 | Replace CSS injection with Tailwind/CSS variables | 228-324 | `src/hooks/useTrackLayout.ts` |
| 6 | AudioContext create/resume/suspend → class | scattered | `src/audio/AudioContextManager.ts` |
| 7 | Track item builder → pure function | 374-429 | `src/lib/multitrack/trackItemBuilder.ts` |
| 8 | Metronome buffer→phrases → utility | 1002-1065 | `src/audio/metronome/metronomePhrases.ts` |
| 9 | BPM debounce → shared `useDebounce` hook | 972-999 | `src/hooks/useDebounce.ts` |

### 5 — CSS via custom properties, not `<style>` injection

Current `adjustLayout` creates a `<style id="multitrack-custom-layout">` element. Replace with CSS custom properties on `:root` + Tailwind classes toggled by the hook.

### 6 — AudioContextManager

```typescript
class AudioContextManager {
  private ctx: AudioContext | null = null;
  get context(): AudioContext { /* create if needed */ }
  resume(): Promise<void>
  suspend(): Promise<void>
  close(): void
  get sampleRate(): number
}
```

### 7 — trackItemBuilder

```typescript
export function buildMultitrackItems(
  tracks: Track[],
  zoom: number,
  waveformQuality: WaveformQuality,
  bpm: number,
  timeSignature: [number, number],
  selectedTrackId: string | null,
  envelopeLocked: boolean,
  trackHeight: number,
  metronomeHeight: number,
  metronomeTrackVisible: boolean,
): TrackOptions[]
```

Pure function. No refs, no store access.

### 8 — metronomePhrases

```typescript
export function generateMetronomePhrases(
  engine: MetronomeEngine,
  bpm: number,
  timeSignature: [number, number],
  duration: number,
): Phrase[]
```

### 9 — useDebounce

Standard debounce hook extracted inline.

---

## Phase 3 — Advanced (Higher Performance Reward)

| # | Change | Rationale |
|---|--------|-----------|
| 10 | De-prioritize envelope in rAF | Envelope at ~30Hz via setTimeout interleaved with rAF |
| 11 | Lazy WaveSurfer for off-screen tracks | Only render visible tracks' canvases |

---

## Result: `useAudioEngine.ts` (~400-500 lines)

```
useAudioEngine
├── usePollTime(multitrackRef, isActive, tick)
│     └── tick calls interpolateEnvelope() per track
├── useTrackLayout(containerRef, multitrackRef, tracks, ...)
├── audioContextMgr = useRef(new AudioContextManager())
├── init → buildMultitrackItems() → MultiTrack.create()
├── sync effects: zoom, moveLocked, selection, positions
├── metronome → generateMetronomePhrases() → store.set
├── engines → RecordingEngine, MetronomeEngine lifecycle
└── callbacks: playPause, seekTo, startRecording, stopRecording
```

## New File Inventory

| File | Lines (est.) | Source |
|------|-------------|--------|
| `src/audio/AudioContextManager.ts` | 40 | New |
| `src/audio/processing/envelopeUtils.ts` | 25 | Extracted from useAudioEngine:618-638 |
| `src/audio/processing/wavesurferPatch.ts` | 25 | Extracted from useAudioEngine:13-38 |
| `src/audio/metronome/metronomePhrases.ts` | 30 | Extracted from useAudioEngine:1002-1065 |
| `src/hooks/usePollTime.ts` | 60 | Extracted from useAudioEngine:564-702 |
| `src/hooks/useTrackLayout.ts` | 50 | Extracted from useAudioEngine:228-324 |
| `src/hooks/useDebounce.ts` | 12 | Extracted from useAudioEngine:972-999 |
| `src/lib/multitrack/trackItemBuilder.ts` | 60 | Extracted from useAudioEngine:374-429 |

## Files Modified

| File | Change |
|------|--------|
| `src/hooks/useAudioEngine.ts` | Remove all extracted blocks; keep orchestration + callbacks |
| `src/index.css` | Add CSS custom properties for track heights |

## Files Deleted

| File | Reason |
|------|--------|
| `src/components/AudioEditorView.tsx` | Dead code, 1134 lines, not imported anywhere |

## Key Constraint

No performance regression on the hot path. Extracted pure functions add zero overhead — same instructions, just moved. rAF idle detection strictly improves performance.
