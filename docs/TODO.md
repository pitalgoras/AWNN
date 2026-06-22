# TODO

## ✅ Done

### Latency Compensation
- `globalLatencyMs + extraLatencyMs` subtracted from `startPos` in `RecordingEngine.handleAudioWorkletStop()`.
- `LatencyCalibrator` rewritten to loop multiple tests.
- `outputLatency`/`baseLatency` read directly from AudioContext at stop time (line 352-355 of RecordingEngine.ts) — bypasses stale store value from Chrome's initial 8ms report.

### Calibration Test Harness (June 2026)
Complete rewrite of `tests/calibration-test/` with 6 tests and full infrastructure:

| Test | File | Status |
|------|------|--------|
| Beep (noise bursts) | `test-beeps.ts` | ✅ |
| BeepFreq (tunable tone) | `test-beepfreq.ts` | ✅ |
| MLS Auto (5 segments, sweep) | `test-mls.ts` | ✅ |
| Clap v2 (looping + chunks) | `test-clap.ts` | ✅ |
| Early-AEC Beep | `test-beep-early.ts` | ✅ |
| Meta-Freq Scan | `test-metafreq.ts` | ✅ |

**Key improvements:**
- Geometric amplitude ladder (0.05→0.80, ×1.5, 8 levels)
- Latency clustering (5ms bins) — agreement builds confidence
- 2-worklet architecture for overlapping clap chunks
- AEC-proof design: claps are novel sounds, silence gaps de-adapt AEC
- Platform-aware constraints: Chrome `{ exact: false }`, Firefox ideal false
- Full Restart + Re-acquire Mic buttons
- POLL/SNAPSHOT worklet handler, `validatePeriodicity()` edge rejection
- Per-test history, loop mode, slider live values, VU meters, noise floor capture
- Diagnostics dump with Vercel Blob upload

**Build:** `tsc && vite build` passes clean.

### Feedback Chat System
- Long-press feedback chat with SidebarPanel shell
- Silent polling, cookie persistence, optimistic admin reply
- Error surfacing, `allowOverwrite: true` for blob PUT

### Docs Updated
- `docs/CALIBRATION_TEST.md` — full architecture rewrite
- `docs/devhistory.md` — sections 39-42 (calibration tests, feedback chat, complete wiring)
- `docs/FEATURES.md` — calibration test + feedback chat features
- `docs/SPECS.md` — calibration test harness spec
- `docs/FUTURE_ENHANCEMENTS.md` — production integration plans

## 🚧 Future

### Production Calibration Integration
Convert test-bed algorithms into a unified calibration flow:
- Per-device latency profiles (`deviceLatencyCache` in `useStore.ts`)
- Platform-aware test selection
- Auto-run on device change
- Confidence-weighted latency estimation
- Visual calibration fallback for impossible cases

### Audit Cleanup (Parked)
See `notes/audit-exploration-2026-05-31.md`. Priority items:
- Remove debug console.logs
- Clean dead imports/unused selectors
- Fix toolbar UI inconsistencies
- Assess orphaned components
- Fix stub/incomplete features
- Fix stale docs (devhistory.md section P is now updated)
