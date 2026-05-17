# Modularize Modals + Import Audio Tracks

## Motivation

App.tsx is ~1700 lines, with 5 inline modal blocks. Each modal duplicates backdrop patterns, close logic, and `stopPropagation`. Track management UI is duplicated between the Settings modal and the upcoming Import Audio Tracks modal. Extracting modals into separate files makes the codebase navigable, testable, and easier to extend.

## New Files Created

| File | Purpose |
|------|---------|
| `src/components/modals/SettingsModal.tsx` | Settings modal (extracted from App.tsx) |
| `src/components/modals/TrackManagerModal.tsx` | Tracks Management modal (uses TrackListEditor) |
| `src/components/modals/MetronomeModal.tsx` | Metronome & Grid modal |
| `src/components/modals/ImportAudioModal.tsx` | Import Audio Tracks modal |
| `src/components/settings/TrackListEditor.tsx` | Shared track list component: rename, reorder, delete, color |
| `src/audio/import/importUtils.ts` | Pure utility functions for import workflow |

## Extracted Modal API

All modals follow a uniform pattern:
```typescript
interface ModalProps {
    show: boolean;
    onClose: () => void;
}
```

Modals read state directly from `useStore()` internally — no prop drilling. The only exception is `ImportAudioModal` which also receives `files: File[]`.

### CSS Columns Layout Rule

`ModalShell` uses CSS `columns-2` at the `sm:` breakpoint to auto-distribute flat children across 2 columns. Modals must pass content as flat `<div>` children — NOT wrapped in a grid or flex container intended for column layout. The `break-inside: avoid` utility prevents items from splitting across columns. This eliminates per-modal column logic: each modal just provides semantically grouped sections, and CSS columns handle the spatial distribution.

## ImportAudioModal Architecture

```
ImportAudioModal
├── File table with dropdown track assignment per file
├── TrackListEditor (shared with TrackManagerModal)
│     ├── Inline rename on name click
│     ├── Up/down arrows for reorder
│     ├── Delete button
│     └── Color picker
└── Import execution
      └── Sequential addPhrase() — waveforms appear one by one
```

### Auto-matching logic

For each filename stem (no extension, lowercased):
1. Exact match against existing non-metronome track names
2. Prefix match (stem starts with track name or vice versa)
3. Instruments variants: `instruments`, `instrumental`, `inst`, `instr`, `accompaniment`, `acc`, `band`, `music`, `backtrack`, `backing`, `back` → Instruments track. No single-letter matching for this track.
4. Single-letter match against the non-repeating part of the filename

### Import execution

Sequential per-file:
1. `file.arrayBuffer()` → `audioContext.decodeAudioData()` → `calculatePeaksAsync()`
2. `addPhrase()` to assigned track (each triggers a clean multitrack re-init)
3. Waveforms appear on the timeline one by one — no progress bar needed

## Sidequest Changes

| File | Change |
|------|--------|
| `src/store/useStore.ts` | `name: 'Backtrack'` → `name: 'Instruments'` (initial state + loadProject fallback) |
| `src/components/TrackToolbar.tsx` | Remove `VOICE_TOKENS` map. Short label = `track.name.substring(0, 4)` for ALL tracks |

## Files Not Changed

- `useAudioEngine.ts` — all modals read from store, no engine changes needed
- `useStore.ts` — only the track name string changes
- All worklets, multitrack, etc. — untouched
