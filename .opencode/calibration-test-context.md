# Calibration Test — Agent Context

## Files

| File | Role |
|------|------|
| `tests/calibration-test/main.ts` | Orchestrator: init, sweep, clustering, history, feedback toggle, health polls |
| `tests/calibration-test/test-mls.ts` | `runMlsTest()` — single MLS measurement with wake clicks |
| `tests/calibration-test/analysis.ts` | DSP: MLS gen, biquad BP, cross-correlation, P2N, trailing edge |
| `tests/calibration-test/test-clap.ts` | `runClapTest()` — manual clap rhythm test |
| `tests/calibration-test/index.html` | Test page layout |
| `public/worklets/calibration-test.worklet.js` | AudioWorkletProcessor: recording, 20Hz activator, PING/PONG, RESET, TOGGLE_FEEDBACK |

## Key Functions

### `main.ts`
- `ensureWorkletReady()` — full init chain (gesture → AudioContext → worklet → graph → mic)
- `generateAmplitudes()` → `[0.05, 0.075, 0.113, 0.169, 0.254, 0.38, 0.57, 0.8]`
- `runMlsWithSweep()` — runs all 8 amplitudes, returns `SweepResult[]`
- `findLatencyCluster()` — bins P2N≥18 results by 5ms, returns winning cluster or null
- `getSweepHistory()` / `storeSweep()` — localStorage, keyed `userAgent|micDeviceId`, last 5
- `toggleFeedback()` — sends `TOGGLE_FEEDBACK` to worklet
- `showGainHint()` — neutral (no mic gain advice — unreliable with Bluetooth gates)

### `test-mls.ts`
- Sends `RESET` + `PING` (waits `PONG`) before each test to drain stale messages
- 3 wake clicks (50ms 1kHz, exponential decay, 250ms gap) → 100ms gap → 500ms MLS burst
- Bandpass at 4kHz, Q=0.707 for both reference and recorded signal
- Decimation factor=4 before cross-correlation (reduces compute)
- Reports start-correlation AND end-detection; best confidence wins
- 15s timeout per test

### Worklet messages
| Message | Action |
|---------|--------|
| `PING` | Responds `PONG` with state, currentFrame, processCount |
| `START {startFrame, duration}` | Records input from startFrame for duration, sends `RESULT` when done |
| `RESET` | Clears `_buffer`, `_recording`, `_pending`, `_inputCount` |
| `TOGGLE_FEEDBACK {enabled}` | Sets `_feedbackEnabled` — when false, output silence |

## Critical Design Decisions

### Why 8 amplitudes × 1.8s = ~14s?
No early-stop. Every amplitude runs. Agreement across levels is the confidence metric, not single-shot P2N. Tradeoff: reliability over speed.

### Why geometric ×1.5?
Dense at quiet end (gate behavior changes fast), sparse at loud end (gate fully open, stable). Linear wastes steps.

### Why RMS not mean for P2N?
Cross-correlation values are centered on zero → mean is arbitrarily small → P2N explodes. RMS ≈ `1/sqrt(N)` gives stable meaningful threshold.

### Why RESET + PING drain before each test?
Worklet `_recording` can get stuck if `_stopFrame` was set but never reached (timing drift). RESET clears all state. PING/PONG drains any stale `RESULT` messages in flight from previous tests.

### Why wake clicks?
Bluetooth noise gates clip sub-threshold signals to zero. Without wake clicks, low-amplitude MLS may be partially or fully gated, shifting the correlation peak or producing no recording.

## Common Failure Patterns

1. **All P2N < 18dB** → MLS too quiet, gate closed, or no speaker→mic path
2. **P2N ≥ 18dB but no cluster** → correlation peaks at different positions per amplitude; likely harmonic interference (activator, 1kHz clicks passing through 4kHz BP)
3. **One amplitude passes, others fail** → that amplitude happened to correlate with noise; cluster requirement (>1 agreeing) prevents false positive
4. **History shows no previous runs** → device combo changed (different mic, different browser), or localStorage cleared
