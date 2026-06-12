# Calibration Test Page — Architecture & Decisions

## Purpose

Isolated test bed at `tests/calibration-test/` for measuring round-trip audio latency via **Maximum Length Sequence (MLS)** cross-correlation and a manual **clap test**. Independent from the production `LatencyCalibrator` — focused on raw measurement accuracy under real-world conditions (Bluetooth headsets, noise gates, browser quirks).

---

## How It Works

### Signal Chain
```
MLS (2–8kHz noise, 0.5s burst)
  → wake clicks (3× 1kHz, 50ms exponential decay)
  → speaker
  → air / headset
  → mic
  → AudioWorklet recording
  → 4kHz bandpass filter (biquad)
  → normalizeCrossCorrelation(recorded, MLSref)
  → latency = argmax(peak) - expected_position
```

### MLS Signal
- Generated via 15-bit LFSR (`generateMLS` in `analysis.ts`, seed=42)
- Bandpass filtered at 4kHz, Q=0.707 (removes 20Hz activator, rejects noise)
- Duration: 0.5s at sample rate (~22050 samples at 44100Hz)
- Preceded by 3 wake clicks (1kHz, exponential decay, 250ms apart) to open noise gates

### Wake Clicks
Bluetooth noise gates clip silence below a threshold. The 3 wake clicks (50ms each, 1kHz) precede the MLS burst to trigger the gate open before the measurement signal arrives. Without wake clicks, low-amplitude MLS bursts may be partially clipped by the gate, shifting the correlation peak.

---

## Recent Changes

### 1. Single-Phase Init with Click Fallback
**Commit**: `8fc99d4`

**Problem**: Two-phase init (scroll/mousemove to prepare, then real gesture to resume AudioContext + get mic) had a race condition where scroll/mousemove removed the click listener before the user tapped, leaving the page stuck on "Tap to activate".

**Solution**: Single-phase init:
- `resume()` attempted directly on any gesture (scroll, mousemove, click, touchstart)
- If `resume()` fails on a non-real gesture (scroll/mousemove can't resume AudioContext on many browsers), register one-shot `click`/`touchstart` listeners
- Once init completes, remove all gesture listeners to prevent re-entry
- No pre/post phases — just try, and if failed, let a real click finish

**Files**: `tests/calibration-test/main.ts`

### 2. MLS Hang Fix — RESET Message + PING Drain
**Commit**: `d3a7649`

**Problem**: A single MLS test records ~1.8s. If the 15s timeout expired while the worklet was still in `_recording = true` (e.g., due to sync drift), the next test's `START` message reset `_pending`/`_recording` to false, but `currentFrame` was already past the new `_startFrame`. This meant `if (this._pending && currentFrame >= this._startFrame)` was never entered (`_pending` became false in the `START` handler, and `currentFrame` would never match again), so recording never started → hang.

**Solution**:
- Added `RESET` message handler in worklet: clears `_buffer`, `_recording`, `_pending`, `_inputCount`
- Before each test in `runMlsTest()`: send `RESET` + `PING`, wait for `PONG` to drain any stale messages from the port
- Before sweep loop in `runMlsWithSweep()`: send `RESET` for extra safety

**Files**: `public/worklets/calibration-test.worklet.js`, `tests/calibration-test/test-mls.ts`, `tests/calibration-test/main.ts`

### 3. Peak-to-Noise Ratio — RMS Not Mean
**Commit**: `9b18e7c`

**Problem**: `peakToNoiseRatio()` used `sum / count` (arithmetic mean) for the noise floor. Cross-correlation values are centered around zero — their mean can be arbitrarily small, making `peak / noiseFloor` explode. This caused spurious P2N values of 100+ dB with completely wrong latency (e.g., -472ms).

**Solution**: Use RMS instead of mean:
```js
// Before:
const noiseFloor = sum / count;

// After:
const noiseFloor = Math.sqrt(sumSq / count);
```
RMS of normalized cross-correlation values is approximately `1/sqrt(N)` where N is the reference length (~0.013 for our decimated MLS). A spurious peak of 0.04 correctly yields ~9.5dB (below the 18dB threshold), while a real peak of 0.3 yields ~27dB.

**Files**: `tests/calibration-test/analysis.ts`

### 4. Geometric Amplitude Ladder + Latency Clustering + History
**Commit**: `8725b71`

**Problem**: Fixed amplitudes `[noiseFloorTargetAmp, 0.1, 0.2, 0.4, 0.6]` were unreliable:
- Noise-floor-derived amplitude was misleading with Bluetooth gates (gate clips silence → low RMS → low target amp → MLS too quiet to open gate)
- Single-shot P2N can spike at wrong position (lucky noise correlation)
- No way to see if the same latency appears across different playback levels

**Solution**:

**Amplitude ladder** — geometric from 0.05 to 0.80, ×1.5 factor:
```
[0.05, 0.075, 0.113, 0.169, 0.254, 0.38, 0.57, 0.8]
```
Quiet enough to measure open-air latency, loud enough to punch through any noise gate. No early-stop — all 8 amplitudes run every time.

**Latency clustering** — instead of picking the single best P2N, collect all results with P2N ≥ 18dB, bin by latency (nearest 5ms), find the largest bin. The winning cluster's mean latency and stddev are reported. A single lucky correlation at the wrong position is ignored because it won't match other amplitudes.

**Cross-run history** — last 5 sweeps stored in localStorage, keyed by `userAgent|micDeviceId`. Display shows "Consistent with N previous sweeps (avg Xms ±Yms)". Every new sweep builds on previous data for the same device combo.

**`showGainHint` neutralized** — removed the "Mic level seems very low → increase gain" warning. Low noise floor is normal with Bluetooth gating, not a problem.

**Files**: `tests/calibration-test/main.ts`

### 5. Feedback Toggle (Mute/Unmute)
**Commit**: `51fd881`

**Problem**: The 20Hz activator tone plays continuously through the speaker to keep the audio worklet path alive. This is audible and can be annoying during setup or between tests.

**Solution**: "Mute Feedback" button in the I/O Level card. When clicked:
- Sends `TOGGLE_FEEDBACK` message to worklet, toggling `_feedbackEnabled`
- When muted, worklet outputs silence (activator phase continues internally to avoid pop on re-enable)
- When unmuted, restores 20Hz activator + mic pass-through
- Tests still work when muted — the MLS BufferSource plays independently

**Files**: `public/worklets/calibration-test.worklet.js`, `tests/calibration-test/main.ts`, `tests/calibration-test/index.html`

---

## Key Design Decisions

### Why MLS over white noise / sine sweeps?
- MLS has perfect autocorrelation (δ-function peak) → precise latency measurement
- Deterministic (LFSR seed=42) → repeatable across runs
- Bandpass filtering at 4kHz removes the 20Hz activator and rejects environmental noise

### Why end-detection as secondary method?
Trailing-edge detection (noise → silence at end of burst) resists Bluetooth noise gate clipping of the burst's attack. Start-correlation is more precise when the gate is open, but end-detection is a fallback when the gate clips the beginning. Both are reported; the higher-confidence result wins.

### Why geometric amplitude sweep?
Linear sweeps waste steps at the quiet end (where the gate is closed) and skip the loud end. Geometric (×1.5) gives dense coverage at quiet levels where behavior changes fast, and sparse coverage at loud levels where the gate is fully open and behavior is stable.

### Why 8 amplitudes × 1.8s ≈ 14s per run?
Each MLS test takes ~1.8s (wake clicks + MLS + settle). 8 amplitudes = ~14-15s. No early-stop means every level runs — the tradeoff is measurement reliability over speed. The 15s per-test timeout (not per-sweep) ensures individual hangs don't stall the entire page indefinitely.

### Why latency clustering instead of single-shot best P2N?
Agreement across amplitudes is stronger evidence than any single high-P2N reading. A correlation peak of 0.04 at the wrong position (P2N=9.5dB with RMS fix) won't match other amplitudes, so it disappears in the cluster. The true latency appears at 0.1, 0.2, 0.4, 0.6, 0.8 → 5 agreeing amplitudes → high confidence.

---

## Architecture

```
tests/calibration-test/
  index.html           — Test page UI (cards, buttons, meters, log)
  main.ts              — Init, health polls, VU meters, MLS sweep orchestrator, history
  test-mls.ts          — runMlsTest(): plays MLS + wake clicks, records, cross-correlates
  test-clap.ts         — runClapTest(): plays rhythm, detects claps via energy envelope
  analysis.ts          — MLS generation, DSP (biquad, correlation, RMS, peaks, trailing edge)
  minimal-test.html    — Standalone worklet test (no Vite)

public/worklets/
  calibration-test.worklet.js — AudioWorkletProcessor: PING/PONG, START/STOP recording, RESET, TOGGLE_FEEDBACK
```

### Data Flow
1. **Init**: gesture → AudioContext → addModule → workletNode → output graph → resume → getUserMedia → mic connected → settle → ready
2. **MLS test**: PING (health check) → RESET + PING/PONG (drain) → `runMlsTest()` for each amplitude → POST START to worklet → play BufferSource → worklet records → RESULT returned → correlation analysis
3. **Sweep**: geometric amplitudes → run all → cluster latencies → check history → display
4. **Clap test**: PING → play metronome → user claps → mic records → detect peaks → compare to expected → latency = median offset

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No amplitude passes P2N threshold | MLS too quiet to trigger gate, or gate clips burst | Check wake clicks are audible; increase minimum amplitude in `generateAmplitudes()` |
| P2N ≥ 18dB but latency wrong (e.g., -400ms) | Wake clicks or activator harmonics correlating with 4kHz BP | RMS P2N fix should prevent this; check that bandpass is centered at 4kHz |
| Worklet stuck "recording" | Stale `_recording` from previous test | Our `RESET` + PING drain should fix; verify in health poll |
| "MLS: failed — no recording" | Worklet not responding or timeout | Check PING/PONG in health poll; check worklet is loaded (`addModule`) |
| AudioContext won't resume on scroll | Firefox/Chrome require user gesture | Single-phase init + click fallback handles this |
| History shows wrong device | Device combo hash changed | Clear localStorage manually |
