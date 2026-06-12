# TODO

- **(DONE) Latency compensation applied**: `globalLatencyMs + extraLatencyMs` now subtracted from `startPos` in `RecordingEngine.handleAudioWorkletStop()`. `LatencyCalibrator` rewritten to loop multiple tests.

- **(SUPERSEDED) Calibration test rewrite**: The `tests/calibration-test/` page was rewritten with:
  - Geometric amplitude ladder (0.05→0.80, ×1.5, 8 levels) — no early-stop
  - Latency clustering across amplitudes (5ms bins) — agreement builds confidence
  - Cross-run history in localStorage (last 5 sweeps per device combo)
  - RMS-based peak-to-noise ratio fix (was mean → fake high P2N)
  - RESET message + PING drain to prevent worklet hang between tests
  - Feedback toggle button (mute/unmute 20Hz activator)
  - Single-phase init with click fallback (no more two-phase race)
  - See `docs/CALIBRATION_TEST.md` and `.opencode/calibration-test-context.md`

- **Production calibrator (`LatencyCalibrator.ts`)**: The test page changes do not affect the production calibrator, which still uses white noise + descending amplitudes. Consider porting the MLS approach to production if the test page proves reliable.
