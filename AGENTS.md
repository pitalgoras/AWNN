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

## Session Context: Latency Calibration

### Goal
Adaptive level probing + round-trip latency calibration working reliably on Firefox+Linux+Bluetooth audio setups.

### Done
- **Continuous looping probe replaces staircase + burst test**: Worklet plays `[NOISE@0.95] [SILENCE] [NOISE@0.7] ...` in an infinite loop with per-cycle RMS/peak stats sent live to main thread. Auto-stops when levels are stable across 2 cycles. Single STOP gives full recording for cross-correlation (latency + amplitude in one pass).
- **ProbeMonitor UI**: Live per-cycle table showing SNR(dB) per level, optimal amplitude estimate, per-level RMS/peak/SNR expandable details. Non-stop debug toggle for exploration.
- **Constraint syntax**: Uses `getSupportedConstraints()` + `advanced` array + `applyConstraints()` on live track, logs `getSettings()` and `getCapabilities()` — **no DiagnosticProbe needed**, just ask the browser
- **Cache-busting**: Worklet URL includes `?ck=${Date.now()}`
- **Lowered correlation thresholds**: 0.15→0.04

### Key Decisions
- **No DiagnosticProbe/DiagnosticModal** — `getSettings()` and `getCapabilities()` tell us what processing the browser is actually applying; no need to play probes to detect it
- **advanced constraint array** gives higher priority than plain booleans in Firefox's constraint resolver
- **applyConstraints() on live track** — sometimes Firefox respects constraints better when re-applied after capture
- **Looping probe eliminates wake gap** — the continuous pattern keeps the Bluetooth speaker triggered without needing a separate wake burst or settling gap
- **Probe IS the test** — level detection and latency measurement happen in the same probe, no separate START phase

### Current Code
- `public/worklets/calibration.worklet.js`: LOOPING state, PROBE_LOOP_START/PROBE_STOP, per-cycle RMS/peak stats, 30s recording buffer
- `src/lib/audio/LatencyCalibrator.ts`: Loop probe params, auto-stop logic, cross-correlation analysis, onProbeReading callback
- `src/components/modals/ProbeMonitor.tsx`: Live cycle data table with SNR, optimal amplitude, per-level details
- `src/components/modals/LatencyCalibrationModal.tsx`: Non-stop toggle, probe monitor display, stop button

### Known Firefox Behavior
- `echoCancellation: false` respected reliably on macOS/Android; on Linux depends on PipeWire/PulseAudio config
- Constraints are best-effort — OS audio routing (PipeWire ALSA, PulseAudio) may inject DSP regardless
- `getSettings()` returns actual applied values; `getCapabilities()` shows what the source supports

## General Guidelines

- Stick strictly to approved plans - do not add extra actions
- When in doubt about a file's purpose, ask the user before deleting
- Report untracked files found during analysis, but do not delete them
- **Ask questions one at a time** — never bundle multiple questions in a single message
