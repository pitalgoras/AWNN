# Operational Rules for AI Agents

## File Deletion Rules

### CRITICAL: Never Delete Untracked Files Without Approval

- **NEVER delete untracked files** (files shown with `??` in `git status`) without explicit user approval
- Untracked files may be intentional work products, session logs, or important notes
- Always ask before deleting any untracked file
- Exception: Files explicitly identified by the user as "ok to delete"

### Approved Deletion Practices

- **Tracked files**: Can be deleted when part of an approved cleanup plan
- **Backup files** (e.g., `*.bak`): Only if user approved "delete backup files" in the plan
- **Empty directories**: Only after removing tracked contents as part of approved plan

## Plan Mode Rules

- When in Plan Mode (read-only): NO file edits, NO git commits, NO file deletions
- Only research, analysis, and presenting findings to user
- Wait for explicit "exit Plan Mode" or "proceed" before making changes

## Git Operations Rules

### CRITICAL: Never Overwrite Local Modified Files Without Consent

- **NEVER overwrite local modified files** with older versions from git without explicit user consent
- This includes commands like: `git checkout -- <file>`, `git restore <file>`, `git reset --hard`, `git pull` when they would discard local changes
- Always check `git status` first - if a file shows as modified (not staged), warn the user and ask before overwriting
- Exception: Only proceed without asking if user explicitly says "overwrite" or "discard changes"

## General Guidelines

- Stick strictly to approved plans - do not add extra actions
- When in doubt about a file's purpose, ask the user before deleting
- Report untracked files found during analysis, but do not delete them
- **Ask questions one at a time** — never bundle multiple questions in a single message

## Session Summary (last session May 2026)

### What was investigated
Metronome stutter and flam variation between recorded and live metronome during playback.

### What was fixed (applied)
1. **Playback metronome timebase** — changed from `ctx.currentTime + startupSec` to `startAudioTime + outputLatency`, anchoring to the multitrack's captured start time instead of an independent React effect clock read. Eliminated play-to-play jitter.
2. **Metronome useEffect deps** — removed `currentTime` from deps (formerly added accidentally, caused 100ms re-sync loop stutter).
3. **Seek path metronome re-sync** — changed from independent `ctx.currentTime` read to `startAudioTime + outputLatency + delta`, same formula as initial sync. Also updates `startAudioTime`/`startMultitrackTime` after seek.
4. **Drift threshold** — `precisionSeconds` 0.05 → 0.3 in `multitrack.ts:427` to avoid pause+play resync on rAF lag from scrolling.
5. **Lint cleanup** — removed unused imports/destructures in `useAudioEngine.ts`, `LatencyCalibrationModal.tsx`, `RecordingEngine.ts`.
6. **Made MultiTrack.startAudioTime/startMultitrackTime public** — so metronome effect can read them.
7. **Added RECORDING_DELTA log breakdown** — now logs `outputLatencyMs`, `baseLatencyMs`, `extraLatencyMs`, `HW_COMP_MS` individually.

### What remains (NOT applied)
**Stale `outputLatencyMs` on first recording** — Chrome reports 0-8ms at AudioContext creation, 46ms after audio flows. Store captures stale value. Fix: read `outputLatency`/`baseLatency` directly from AudioContext in `handleAudioWorkletStop()`.

See `docs/devhistory.md` sections M-P for full details on all findings and the remaining fix plan.

### Files modified in this session
- `src/hooks/useAudioEngine.ts` — metronome timebase, seek path, lint cleanup, deps fix
- `src/lib/multitrack/multitrack.ts` — precisionSeconds, public startAudioTime/startMultitrackTime
- `src/audio/recording/RecordingEngine.ts` — _rollingOffset, RECORDING_DELTA log
- `src/components/modals/LatencyCalibrationModal.tsx` — removed unused Zap import
- `docs/devhistory.md` — sections M-P added
