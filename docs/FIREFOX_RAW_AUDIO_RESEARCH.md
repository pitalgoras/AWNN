# Firefox Raw Audio Capture — Research Findings

## Problem

Raw audio capture (echo cancellation, noise suppression, and auto-gain control all disabled) worked in Chrome but was broken in Firefox. Latency calibration results were unstable (28–155ms spread vs Chrome's 96–116ms).

## Evolution of Findings

### Phase 1: `echoCancellation: false` alone (wrong)

**Commit:** `6ca8e8d`

Initial assumption: Firefox enters a "passthrough mode" in its libwebrtc module when only `echoCancellation: false` is set, disabling all processing as a side effect.

**Constraints tested:**
```js
// Firefox (Phase 1 — incorrect)
{ echoCancellation: false }
```

**Problem:** Calibration results stayed unstable. `getSettings()` showed processing was still active. The passthrough-mode theory was incorrect.

### Phase 2: All three constraints + `sampleRate` (correct)

**Commit:** `a4ec9c2`

**Constraints:**
```js
// Firefox (Phase 2)
{
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: audioContext.sampleRate,  // match AudioContext
}
```

All three ideal constraints set to `false`, plus `sampleRate` matching the `AudioContext` to avoid resampling.

### Phase 3: AEC Cannot Be Disabled on Firefox (calibration test harness, June 2026)

**Finding:** Even with all three ideal constraints, Firefox on Linux applies system-level AEC via PulseAudio. The constraints are non-binding target hints — `getSettings()` may show `echoCancellation: false` but PulseAudio still processes the stream.

**Key facts:**
- `{ exact: false }` is not supported by Firefox — throws `OverconstrainedError`
- `echoCancellation: false` is a non-binding target constraint per MDN spec
- Only `about:config` flags can force-disable AEC on Firefox
- This is a spec-level limitation, not a code bug

**Strategic impact:**
This finding reshaped the calibration test strategy. Instead of trying to disable AEC on Firefox, tests were redesigned to work with AEC present:
- **Clap v2**: Novel sound (user clap) is not echo, so AEC doesn't suppress it
- **Early-AEC beep**: Runs during AEC filter pre-convergence window (~2–5s) when suppression is weakest
- **Silence gaps**: Between clap chunks, brief silences partially de-adapt the AEC filter
- Chrome/Chromium remain the reliable platform for tone-based tests

**Calibration test call sites:**
- `tests/calibration-test/main.ts` — `ensureWorkletReady()` and `reacquireMic()` use same platform-aware pattern

**See also:** `docs/CALIBRATION_TEST.md` (AEC Strategy section) for the full picture.

## Root Causes

### 1. `{ exact: false }` is Chrome-only

Firefox throws `OverconstrainedError` when constraints use `{ exact: false }` — this means "I require this to be exactly false, fail if unavailable." Chrome handles it gracefully and disables the feature.

**Correct pattern:**
```js
// Chrome: required constraints (throws if unavailable)
{ echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }

// Firefox: ideal constraints (best-effort, no throw)
{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }
```

### 2. `goog*` WebRTC flags are Chrome-internal

Chrome exposes internal WebRTC flags as `MediaTrackConstraints`:
- `googEchoCancellation`
- `googAutoGainControl`
- `googNoiseSuppression`
- `googHighpassFilter`
- `googTypingNoiseDetection`

Firefox rejects these as unknown constraints, crashing `getUserMedia`. They must be guarded behind a UA check.

### 3. `sampleRate` mismatch causes resampling

If the mic stream's sample rate doesn't match the `AudioContext` sample rate, the browser inserts a resampling step that can introduce latency and processing artifacts. Setting `sampleRate: ctx.sampleRate` on Firefox avoids this.

**Chrome note:** Chrome's `{ exact: false }` constraints inherently disable resampling. The `sampleRate` constraint is unnecessary for Chrome.

### 4. `channelCountMode: 'explicit'` breaks Firefox input

Setting `channelCountMode: 'explicit'` on the worklet `AudioNode` causes Firefox to fail input capture silently (no audio frames arrive at the worklet). Removed in commit `f524e7c`.

## Browser Detection Pattern

```js
const isChrome = /Chrome/.test(navigator.userAgent);
```

This detects Chrome (including Chromium-based browsers). Firefox, Safari, and others take the non-Chrome path.

**Important:** This check should be used at every `getUserMedia` call site. All call sites in AWNN use the same pattern:

| Call Site | File |
|-----------|------|
| `RecordingEngine.initializeForPlayback()` | `src/audio/recording/RecordingEngine.ts` |
| `RecordingEngine.initStream()` | `src/audio/recording/RecordingEngine.ts` |
| `LatencyCalibrator.runCalibration()` | `src/lib/audio/LatencyCalibrator.ts` |
| `ensureWorkletReady()` | `tests/calibration-test/main.ts` |
| `reacquireMic()` | `tests/calibration-test/main.ts` |

## Diagnostic Tool: `getSettings()`

After each `getUserMedia` call, the actual resolved constraints are logged via `getSettings()`:

```js
const track = stream.getAudioTracks()[0];
console.log('mic settings:', track?.getSettings());
```

**What to check in Firefox console:**
- `echoCancellation: false`
- `noiseSuppression: false`
- `autoGainControl: false`
- `sampleRate` matches `AudioContext.sampleRate`

If any of these show `true`, the raw audio path is broken.

## Final Working Configuration

### Chrome
```js
{
  echoCancellation: { exact: false },
  noiseSuppression: { exact: false },
  autoGainControl: { exact: false },
  googEchoCancellation: false,
  googAutoGainControl: false,
  googNoiseSuppression: false,
  googHighpassFilter: false,
  googTypingNoiseDetection: false,
}
```

### Firefox (and non-Chrome browsers)
```js
{
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: audioContext.sampleRate,
}
```

## Key Takeaways

1. **Always verify with `getSettings()`** — constraint satisfaction is browser-dependent and can silently degrade.
2. **`{ exact: false }` means "mandatory"** — use only in Chrome; Firefox throws `OverconstrainedError`.
3. **All three constraints needed on Firefox** — `echoCancellation` alone does NOT trigger passthrough mode (contrary to initially reported).
4. **Matching `sampleRate` prevents resampling** — set to `AudioContext.sampleRate` on non-Chrome browsers.
5. **`goog*` flags are Chrome-only** — must be guarded by UA check; Firefox rejects them.
6. **`channelCountMode: 'explicit'` breaks Firefox AudioWorklet** — omit it for cross-browser compatibility.

## Commits

| Commit | Description |
|--------|-------------|
| `6ca8e8d` | Initial Firefox raw audio fix (incorrect: `echoCancellation: false` alone) |
| `59288fc` | Documentation of Phase 1 findings (now outdated) |
| `f524e7c` | Remove `channelCountMode: explicit` from calibrator worklet |
| `a4ec9c2` | **Correct fix:** restore all three constraints + `sampleRate` |
| `5fa147b` | Add `getSettings()` logging for diagnostics |
| `351cfaf` | Calibration tests: clap v2 wiring, early beep, meta-freq, full restart + docs |
