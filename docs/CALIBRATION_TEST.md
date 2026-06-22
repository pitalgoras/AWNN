# Calibration Test Page — Architecture & Decisions

## Purpose

Isolated test bed at `tests/calibration-test/` for measuring round-trip audio latency using 6 algorithms. Independent from the production `LatencyCalibrator` — focused on raw measurement accuracy under real-world conditions (Bluetooth headsets, noise gates, browser quirks, AEC).

**Key constraint:** Firefox cannot disable AEC via Web API (`{ exact: false }` not supported, `echoCancellation: false` is non-binding target). All tests must work with AEC present or be designed to defeat it.

---

## The 6 Tests

### 1. Beep Test (`test-beeps.ts`)
- 5 noise bursts (4kHz bandpass, 50ms each) with irregular gaps
- Trailing-edge detection (sound→silence) resists noise gate onset truncation
- Pattern matching via `findBestShift` — sliding window matches the 5-edges pattern
- Configurable amplitude (0.24–1.0 slider)

### 2. BeepFreq Test (`test-beepfreq.ts`)
- 5 square wave bursts at tunable frequency (1kHz–10kHz)
- Same trailing-edge detection as Beep test
- Optional 4kHz bandpass filter on recording analysis (checkbox)
- Frequency slider + amplitude slider — find the speaker-mic sweet spot

### 3. MLS Auto Test (`test-mls.ts`)
- 5 MLS (Maximum Length Sequence) noise segments with configurable gaps
- Bandpass at 4kHz, Q=0.707
- Primary: trailing-edge detection per segment
- Secondary: cross-correlation against reference MLS signal for sample-accurate peak
- Sweeps across geometric amplitude ladder (0.05→0.80 ×1.5, 8 levels)
- Latency clustering: results binned by 5ms — the largest bin wins (agreement across amplitudes builds confidence)
- Cross-run localStorage history: last 5 sweeps per device combo

### 4. Clap Test v2 (`test-clap.ts`) — AEC-Proof Design
- Plays a looping rhythmic pulse (1kHz click, exponential decay)
- Half-beat-early anchor on last beat of each loop for unambiguous timing
- User claps along — claps are novel sounds, not echo, so AEC won't suppress them
- **2-worklet overlapping chunks**: Two staggered `AudioWorkletNode` instances record alternating windows. While one records, the other is idle (AEC filter partially de-adapts)
- Configurable chunk size (1–5s), gap between chunks (50–500ms), BPM (60–180)
- Silences during gaps encourage AEC filter de-adaptation
- Start/Stop toggle via `AbortController` — runs indefinitely until stopped
- Per-chunk live progress display showing latency, stddev, matched clap count
- Cross-chunk consistency: final result is mean of all valid chunks

### 5. Early-AEC Beep Test (`test-beep-early.ts`)
- Shorter beep variant with gaps [80, 120, 180, 100]ms — optimized for the AEC pre-convergence window (~2-5s after stream start)
- Higher default amplitude (0.4 vs 0.3 for standard beep)
- Auto-runs after mic re-acquire to exploit fresh AEC filter
- Same trailing-edge detection + `findBestShift` pattern matching

### 6. Meta-Freq Scan (`test-metafreq.ts`)
- 26 log-spaced frequencies (127Hz–10kHz, 4/octave)
- Square wave bursts, 50ms each
- Per-frequency amplitude measurement via bandpass filter at each frequency
- Canvas graph with log-frequency X axis, amplitude in dB Y axis
- Highlights peak frequency
- One-per-device diagnostic (~60s full scan)

---

## Infrastructure

### Audio Graph
```
Output chain:
  extActivator (20Hz) → mixer → workletNode → outputAnalyser → destination
                                         → workletNodeB ┘

Input chain:
  mic → inputAnalyser → mixerNode → workletNode
                       → mixerNodeB → workletNodeB
```

- **Two worklet nodes** (`workletNode`, `workletNodeB`) — identical `AudioWorkletNode` instances using `test-recorder` processor
- Alternating use for clap test overlapping chunks
- Single `outputAnalyser` for both output VU meter and health polling

### Worklet (`calibration-test.worklet.js`)
- **START** message: `{ startFrame, duration }` — records `duration` samples starting at `startFrame`
- **RESET** message: clears `_buffer`, `_recording`, `_pending`, `_inputCount` — prevents stale-state hangs
- **RESULT** message: returns recorded `Float32Array` (transferable, zero-copy)
- **PING/PONG**: health polling — returns `currentFrame`, `processCount`, `state`
- **POLL/SNAPSHOT** (added for future progressive analysis): copies buffer on poll for non-destructive inspection
- **TOGGLE_FEEDBACK**: mutes/unmutes the 20Hz activator pass-through

### Signal Processing (`analysis.ts`)
- `findBestShift` — sliding window pattern matching with configurable tolerance
- `computeRMS` — root-mean-square for energy estimation
- `biquadBP` / `biquadHP` — biquad bandpass/highpass filters
- `generateNoise` — LFSR-based white noise (seed=42, deterministic)
- `crossCorrelate` — normalized cross-correlation for MLS peak detection
- `trailingEdgeDetection` — sliding RMS envelope, threshold crossing (sound→silence)
- `validatePeriodicity` — rejects false edge detections by checking gap pattern consistency

### UI Components
- **Status card**: output/base/heuristic latency, input/output device names, AEC state, settle trace
- **Device info**: enumerated audio devices with active device highlighting
- **I/O VU meters**: real-time RMS + peak level for both output and input
- **Noise floor capture**: 0.5s silent recording, RMS and dBFS displayed, target amplitude derived
- **Per-test cards**: controls (sliders, checkboxes) + result + history (last 3 runs)
- **Diagnostics**: health poll, PING roundtrip timing, full state dump, upload to Vercel Blob
- **AEC state display**: `echoCancellation`, `noiseSuppression`, `autoGainControl` from `getSettings()`

### Button Infrastructure
- **Re-acquire Mic**: stops current stream, re-requests `getUserMedia`, reconnects to both worklet nodes, auto-runs Early-AEC beep
- **Full Restart**: stops polls, closes AudioContext, resets all state, re-initializes from scratch
- **Force Init**: bypasses gesture-based init, directly calls `ensureWorkletReady()`
- **Device change handler**: auto-reacquires mic when device changes (e.g., plugging in headphones)

---

## AEC Strategy

### The Problem
Firefox on Linux cannot disable AEC via Web API. `{ exact: false }` throws `OverconstrainedError`. `echoCancellation: false` is a non-binding target — PulseAudio may apply system-level AEC regardless. Chrome can disable AEC with `{ exact: false }` constraints + `goog*` WebRTC flags.

### Mitigations (Tests)
1. **Clap v2** — Novel sound (user clap) is not echo, so AEC doesn't suppress it. The primary strategy.
2. **Early-AEC beep** — Runs immediately after mic re-acquire, during the AEC filter's ~2-5s pre-convergence window when suppression is weakest.
3. **Silence gaps between clap chunks** — Brief silences partially de-adapt the AEC filter, giving each new chunk a short pre-convergence advantage.
4. **Platform-aware constraints**:
   - Chrome: `{ exact: false }` for all three processing flags + `goog*` WebRTC flags
   - Firefox: all three ideal constraints set to false + matching `sampleRate`

### Platform Comparison (Diagnosed via getSettings() logging)

| Browser | Constraints | AEC | Notes |
|---------|------------|-----|-------|
| Chrome | `{ exact: false }` | Disabled reliably | OverconstrainedError if AEC can't be disabled |
| Firefox | `echoCancellation: false` ideal | May still process | PulseAudio system-level AEC may apply |
| Both | UA check + platform-specific constraints | Per-browser | `getSettings()` confirms actual state |

---

## Key Design Decisions

### Why two worklet nodes for clap test?
A single worklet node alternates between recording and idle. During recording, it captures a contiguous window. During the silence gap, the AEC filter begins to de-adapt. Two nodes allow the next chunk to start recording immediately while the previous node's data is being analyzed — no gap between chunk end and next chunk start from the analysis perspective.

### Why trailing-edge over onset-edge?
Bluetooth noise gates clip the beginning of sound (onset). By the time the sound stops (trailing edge), the gate is already open. Trailing-edge detection is more reliable with gated audio paths.

### Why geometric amplitude sweep (MLS)?
Linear sweeps waste steps at quiet levels (gate closed) and skip loud levels (gate fully open). Geometric (×1.5) gives dense coverage where behavior changes fast and sparse coverage where it's stable.

### Why latency clustering?
Agreement across amplitudes is stronger evidence than any single high-P2N reading. A spurious correlation at the wrong position won't match other amplitudes. True latency appears across multiple levels.

### Why not use cross-correlation for all tests?
Cross-correlation requires a deterministic reference signal (like MLS). Tests using beeps or claps use pattern matching instead (`findBestShift`), which works with any signal shape.

---

## Architecture

```
tests/calibration-test/
  index.html              — Test page UI (cards, buttons, meters, log, canvas)
  main.ts                 — Init, health polls, VU meters, all test orchestrators, button wiring
  test-beeps.ts           — runBeepTest(): noise bursts, trailing-edge, pattern match
  test-beepfreq.ts        — runBeepFreqTest(): tunable tone bursts
  test-mls.ts             — runMlsTest(): MLS segments with RESET + PING drain
  test-clap.ts            — runClapTest(): looping pulse, 2-worklet overlapping chunks
  test-beep-early.ts      — runEarlyBeepTest(): shorter gaps, pre-convergence optimization
  test-metafreq.ts        — runMetaFreqTest(): 26-frequency log scan
  analysis.ts             — DSP: biquad, RMS, cross-correlation, edge detection, validatePeriodicity
  minimal-test.html       — Standalone worklet test (no Vite)

public/worklets/
  calibration-test.worklet.js — AudioWorkletProcessor: PING/PONG, START/STOP/RESET, POLL/SNAPSHOT,
                                TOGGLE_FEEDBACK, transferable RESULT
```

### Data Flows

**Beep / BeepFreq / Early tests:**
```
PING (health) → RESET + PING/PONG (drain) → POST START to worklet → play BufferSource →
worklet records → RESULT returned → detect trailing edges → findBestShift match → latency
```

**MLS Sweep:**
```
PING → RESET + PING/PONG → for each amplitude:
  runMlsTest() → RESET + PING/PONG → START → play MLS → RESULT → correlate
→ cluster all amplitude results → display cluster mean ± stddev
```

**Clap v2:**
```
PING → AbortController → LOOP:
  chunk on workletNode A: START → record → RESULT → analyze
  silence gap (AEC de-adapt)
  chunk on workletNode B: START → record → RESULT → analyze
  silence gap
  swap back to A
  until Stopped
→ aggregate all chunks → display mean ± stddev across valid chunks
```

**Meta-Freq:**
```
for each of 26 frequencies:
  generate frequency beep → START → play → RESULT → measure amplitude at frequency
→ render canvas graph → highlight peak
```

---

## Recent Changes

### POLL/SNAPSHOT Handler (worklet)
Added for future progressive analysis use (e.g., vocal calibration). On `POLL`, worklet copies the current buffer content and sends it as `SNAPSHOT`. Currently unused by any test — the chunked clap test uses independent START→RESULT cycles.

### validatePeriodicity() (analysis.ts)
Helper for gap-pattern edge rejection. After trailing-edge detection, checks that detected edges match the expected gap pattern within tolerance. Rejects false positives from echoes or ambient noise.

### Clap v2 Rewrite
Complete rewrite: looping steady pulse with half-gap anchor, overlapping 2-worklet chunks, configurable chunk size/gap duration, progressive per-chunk analysis, cross-chunk consistency. Old clap test (single-worklet, fixed pattern) replaced.

### Early-AEC Beep Test
Shorter beep variant with gaps optimized for pre-convergence AEC window. Auto-runs after mic re-acquire. Separate test card with dedicated amplitude slider.

### Meta-Freq Scan
26-frequency log scan with canvas graph. Measures which frequencies pass through headphone-mic path best. One-per-device diagnostic (~60s).

### Full Engine Restart
New button that fully tears down AudioContext, stops all polls, resets all state variables, and re-initializes from scratch. Useful for recovery after edge cases.

### Device Change Auto-Reacquire
`devicechange` listener auto-runs `reacquireMic()` on device change. Shows AEC state, enumerates devices, auto-runs Early-AEC beep.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No amplitude passes edge threshold | Signal too quiet for noise gate | Increase amplitude; check wake clicks are audible |
| Latency wrong (e.g., -400ms) | Noise gate clipping onset | Clustering rejects these; trailing-edge helps |
| Worklet stuck "recording" | Stale state from previous test | RESET + PING drain should fix; try Full Restart |
| Clap test no chunks collected | Chunk too short or gap too small | Increase chunk size; ensure claps fall within chunk window |
| AEC shows "may process" on Firefox | Platform limitation | Use clap test (novel sound defeats AEC) or Early-AEC (pre-convergence) |
| AudioContext won't resume | Requires user gesture | Single-phase init + click fallback handles this |
| Canvas graph not rendering | No data or missing canvas | Run Meta-Freq test first — canvas appears on completion |

---

## Future Work

### Production Integration
1. Convert test-bed algorithms into a unified calibration flow within the app
2. Per-device latency profiles stored in `deviceLatencyCache` (already in `useStore.ts`)
3. Platform-aware test selection: clap v2 as primary for Firefox, MLS/beep for Chrome
4. Auto-run calibration on first use or when new device detected
5. Visual calibration overlay as fallback for impossible cases

### Vocal Calibration
The POLL/SNAPSHOT handler and chunked approach in clap v2 were designed with future vocal calibration in mind. The same overlapping-chunk architecture could record a user singing a reference and align it to expected timing.
