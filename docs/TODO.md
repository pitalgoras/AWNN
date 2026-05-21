# TODO

- **(DONE) Latency compensation applied**: `globalLatencyMs + extraLatencyMs` now subtracted from `startPos` in `RecordingEngine.handleAudioWorkletStop()`. `LatencyCalibrator` rewritten to loop multiple tests.

- **Enhance calibration test**: Reduce test duration further. Current: 250ms burst, 800ms per test, 5 tests ≈ 4s. Consider single long burst with multiple peak detection or swept sine to measure latency at multiple frequencies simultaneously.
