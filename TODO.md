# TODO

## Latency Calibration — Firefox+Linux+Bluetooth

### Goal
Get round-trip latency calibration working reliably on Firefox with Bluetooth speakers on Linux.

### What's Done
- [x] Envelope-based matching (Pearson correlation) replaces per-segment stats
- [x] Worklet LOOPING state: continuous staircase pattern (0.95→0.1), records mic, per-cycle envelope
- [x] `advanced` constraint array + `applyConstraints()` for better Firefox compliance
- [x] `getSettings()` + `getCapabilities()` logging for verification
- [x] Auto-stop after 2 stable cycles (toggleable non-stop debug mode)
- [x] Live ProbeMonitor: per-cycle table, optimal amplitude, per-level details
- [x] Cross-correlation fine-tuning on STOP for precise latency + amplitude
- [x] Worklet cache-busting via `?ck=${Date.now()}`
- [x] Confidence check: sample-level attack vs envelope delay sanity
- [x] Retry loop with amplitude reduction on clipping (3 attempts)
- [x] `matchEnvelope()` exported for reusable envelope correlation
- [x] Debug API at `window.__calibrationDebug.run()` and `.testEnvelope()`
- [x] **Phase 1a**: Silence gaps (5ms) + cycle gaps (30ms) re-added to probe pattern
- [x] **Phase 1b**: SILENCE phase added to worklet state machine (`advanceLoopPhase`)
- [x] **Phase 1c**: Per-level reverb floor measurement now live (gaps trigger it)
- [x] **Phase 1d**: ProbeMonitor shows `dBvR` (dB vs reverb) per level
- [x] **Phase 2a**: crossCorrelate margin narrowed 3ms→1ms for finer resolution
- [x] **Phase 2b**: Latency formula allows ±1ms fine-tuning (was clamped to ≥0)
- [x] **Phase 3a**: Removed duplicated `latencyMs` from `DebugResult` (use `averageLatencyMs`)
- [x] **Phase 3b**: `startupDelayMs`/`bufferSafetyMs` verified wired in `RecordingEngine`
- [x] **Modal**: Browser latency display (outputLatency + baseLatency) with Refresh button
- [x] **Store**: `outputLatencyMs`, `baseLatencyMs`, `setAudioContextLatency`, `refreshAudioLatency`
- [x] **Global**: `window.__audioContext` exposed for latency refresh
- [x] **openDAW switch**: RecordingEngine now uses `outputLatencyMs + baseLatencyMs` instead of `globalLatencyMs`
- [x] **Start-of-recording refresh**: `refreshAudioLatency()` called in `useAudioEngine.startRecording` before each take

### Next Steps
- [ ] **Test on Firefox+Linux+Bluetooth**:
  - Open Settings → Auto Calibration → Run
  - Check console for settings/capabilities/stats
  - Verify probe monitor shows live data with dBvR
  - Verify auto-stop fires (or use non-stop mode)
  - Verify latency result is reasonable
  - Check Browser Latency section shows correct outputLatency/baseLatency
  - Test Refresh button after changing audio device
  - Record a clip — verify alignment with outputLatency-based compensation
  - Check `RECORDING_DELTA` log — `latencyCompMs` should equal `(outputLatencyMs + baseLatencyMs + extraLatencyMs)`
- [ ] If constraints not honored on Linux: add PipeWire/PulseAudio guidance
- [ ] If latency is wrong: adjust analysis thresholds

### Files
- `src/lib/audio/LatencyCalibrator.ts` — loop probe + analysis
- `public/worklets/calibration.worklet.js` — LOOPING state, per-cycle stats
- `src/components/modals/ProbeMonitor.tsx` — live cycle data UI
- `src/components/modals/LatencyCalibrationModal.tsx` — integration
- `src/store/useStore.ts` — outputLatencyMs/baseLatencyMs state + refresh action
- `src/hooks/useAudioEngine.ts` — __audioContext exposure + latency store update
