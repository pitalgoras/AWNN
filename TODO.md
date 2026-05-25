# TODO

## Latency Compensation

### Goal
Consistent recording clip alignment using `outputLatency + baseLatency + HW_COMP_MS + extraLatencyMs`.

### Done
- [x] Modal: Browser latency display (outputLatency + baseLatency) with Refresh button
- [x] Store: `outputLatencyMs`, `baseLatencyMs`, `setAudioContextLatency`
- [x] `window.__audioContext` exposed for latency reading
- [x] RecordingEngine reads `outputLatencyMs`/`baseLatencyMs` from store synchronously at stop time
- [x] `frameOffset` sent in START_RECORDING for pre-roll alignment
- [x] `headLength` sent per-recording via START_RECORDING
- [x] `HW_COMP_MS` = 171
- [x] Metronome synced from `startRecording()` inline (no useEffect delay)
- [x] Separate effects removed — no React timing races

### Next Steps
- [ ] Test count-in=always and count-in=None — verify consistent `latencyCompMs` across takes
- [ ] Dial `HW_COMP_MS` or `extraLatencyMs` for precise alignment
- [ ] Remove calibrator code if unused
