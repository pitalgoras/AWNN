# Recording Logic & Features

## Terminology

| Term | Definition |
|------|-------------|
| **Rolling buffer** | 2-second continuous capture in AudioWorklet, always active during playback |
| **Capture** | The AudioWorklet's act of recording into `_audioData` |
| **Recording** | Final saved audio (includes head if present) |
| **Head** | Audio already in rolling buffer (up to `headLength` seconds) when definitive recording starts — extracted by `_flush()` from the single buffer. The rolling buffer stops trimming at `_recordingStartFrame`, preserving the head window through the end of the recording. |
| **Pre-roll** | 1 bar (2s at 120 BPM) of PLAYBACK before punch-in — for timing, NOT recording |
| **Anchor (anchoredFrame)** | AudioContext clock frame number = `currentFrame + frameOffset` in the worklet, where `frameOffset = startupDelay + max(0, punchInUserTime − recordStartUserTime)`. Marks where definitive audio starts. Source of truth for sync, Reset, and Undo. |
| **frameOffset** | Sent in START_RECORDING message. For count-in=always: `startupDelay + secondsPerBar`. For count-in=None: `startupDelay`. Worklet adds to `currentFrame` to compute `_anchoredFrame`, aligning the anchor with bar 1's AudioContext time. |
| **startupDelay** | Estimated time (150ms default) between `onSetIsPlaying(true)` call and actual AudioContext playback start in the AudioWorklet |
| **bufferSafety** | Extra wait margin (100ms default) after headLength to ensure rolling buffer is populated before START_RECORDING is posted |

---

## States Table

| # | Pre-roll mode | State when Record pressed | Head captured | anchoredFrame | startPosition |
|---|--------------|--------------------------|--------------|---------------|---------------|
| 1 | always | STOPPED | YES (`headLength` seconds from rolling buffer) | `floor(punchInReal × sr)` | `punchInUserTime − HL` |
| 2 | always | PLAYING | YES (`headLength` seconds from rolling buffer) | `floor(punchInReal × sr)` | `punchInUserTime − HL` |
| 3 | none | STOPPED | YES (`headLength` seconds from rolling buffer) | `floor(punchInReal × sr)` | `punchInUserTime − HL` |
| 4 | none | PLAYING | YES (`headLength` seconds from rolling buffer) | `floor(punchInReal × sr)` | `punchInUserTime − HL` |

**For ALL states:**
- `punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn` — AudioContext clock reference
- `anchoredFrame = floor(punchInUserTime_Real × sampleRate)` — AudioContext clock frame (ground truth)
- `startPosition = punchInUserTime − headLength` — visual clip computed directly from UserTime
- `headLength` is per-clip metadata (editable), defaulting to the global setting at recording time
- No `audioOffset` needed — `playAt()` plays buffer from position 0
- `startupDelay` (150ms) and `bufferSafety` (100ms) editable in Dangerous Settings

---

## How It Works

### Recording Flow
1. Rolling buffer captures continuously during playback (2s ring buffer in AudioWorklet)
2. User presses Record at punchInTime
3. `START_RECORDING` sent with `headLength` (per-clip) and `frameOffset = startupDelay + max(0, punchInUserTime − recordStartUserTime)`
4. Worklet sets `_anchoredFrame = currentFrame + frameOffset`, `_recordingStartFrame = _anchoredFrame`. Rolling buffer **stops trimming** at this frame.
5. Audio continues flowing into the single buffer until STOP_RECORDING.
6. `_flush()` extracts: [head: last `headLength` seconds before `_recordingStartFrame`] + [definitive recording from `_recordingStartFrame` onward].
7. `startPosition = punchInUserTime − headLength − latencyCompMs / 1000`, where `latencyCompMs` is computed in one of three paths:
   - **New-style cached profile** (preferred): `browserLatencyMs + (cachedProfile.totalRoundtripMs − captureBrowserMs) + extraLatencyMs` — preserves the calibrated hardware delta while using a fresh `browserLatencyMs` from the current AudioContext state
   - **Legacy cached profile**: `cachedProfile.totalRoundtripMs + extraLatencyMs` — uses the profile's total roundtrip directly, ignores browser latency
   - **No cache (fallback)**: `browserLatencyMs + HW_COMP_MS + extraLatencyMs` — heuristic when no calibration profile exists
   
   `browserLatencyMs = outputLatencyMs + baseLatencyMs`, where both values are read **directly from the AudioContext at stop time** via `(audioContext.outputLatency || 0) * 1000` and `(audioContext.baseLatency || 0) * 1000`. This bypasses the store to avoid capturing Chrome's stale initial 0-8ms `outputLatency` report (before audio flows), which caused the first recording in a session to use ~38ms less compensation than subsequent recordings. Audio flows during recording so `outputLatency` is settled by stop time. The store values (`config.outputLatencyMs`/`baseLatencyMs`) initialized at AudioContext creation are **not used** during latency compensation — they are only retained for diagnostics display.

### Playback Flow
1. WaveSurfer reaches `startPosition` (which includes the head before the definitive audio)
2. `playAt()` plays buffer from position 0 — head audio first, then definitive recording
3. Audio stays in sync because `anchoredFrame` is derived from the shared AudioContext clock

### Key Insight
- `anchoredFrame` is the single source of truth for sync (absolute shared-clock frame)
- `startPosition` places the visual clip, accounting for the head prefix
- `playAt()` simply plays the buffer sequentially — no complex offset math needed
- Moving a clip: `anchoredFrame += delta × sampleRate` — anchor shifts with position
- Resetting: restore `originalAnchoredFrame` → original `startPosition` is recovered

---

## User Time vs Real Time

| Concept | User Time (Timeline) | Real Time (AudioContext) |
|---------|----------------------|--------------------------|
| **Definition** | Timeline position (Bar 1 = 0) | `audioContext.currentTime` (since creation) |
| **Used For** | `startPosition`, timeline display | AudioWorklet frames, WebAudio API |

- `punchInUserTime` is **User Time** → used for `startPosition`
- AudioWorklet uses **Real Time** for capture timing

---

## Implementation

### RecordingEngine.ts
- Calculate `punchInUserTime` when Record pressed (UserTime). When `isCurrentlyPlaying`, use `storeState.currentTime` (multitrack playhead position), NOT `audioCtx.currentTime` (fixes clip-in-future bug)
- Send `START_RECORDING { headLength, frameOffset }` to AudioWorklet — `frameOffset = startupDelay + max(0, punchInUserTime − recordStartUserTime)`
- Worklet computes `_anchoredFrame = currentFrame + frameOffset`
- `startPosition = punchInUserTime − headLength − latencyCompMs / 1000`, where `latencyCompMs` reads `outputLatencyMs`/`baseLatencyMs` **directly from `audioContext.outputLatency`/`audioContext.baseLatency` at stop time** (store values are not used)

### RecorderWorklet (worklet)
- Single rolling buffer for both head and definitive recording (no separate `_audioData`)
- Trimming stops at `_recordingStartFrame` — preserves head window + recording in one buffer
- `_flush()`: iterates buffer, extracts last `headLength` seconds before `_recordingStartFrame` as head, then includes data from `_recordingStartFrame` onward as definitive recording
- **Accumulator buffer**: Pre-allocated `Float32Array(4096)` in constructor. Input from each `process()` call copies into the accumulator; `_pushAccumulator()` batches to `_rollingBuffer` only when full (~93ms). Reduces per-call allocations from ~344/s to ~11/s with zero architectural change.

### WebAudioPlayer (webaudio.ts)
- Stores `_anchoredFrame` and `_headLength` as metadata
- `playAt()`: offset = `playedDuration` (plays entire buffer from position 0)
- Moving a clip updates `anchoredFrame` relative to `originalAnchoredFrame`
- Reset restores `originalAnchoredFrame` and recalculates `startPosition`

### MultiTrack (multitrack.ts)
- Anchored tracks: creates `WebAudioPlayer` with `{ anchoredFrame, headLength }`
- Non-anchored tracks (metronome): creates `WebAudioPlayer` with `{ headLength: 0 }`

### TakeBar.tsx
- Head length input: editable per-clip (0–1s, step 0.1)
- Reset button: restores `originalAnchoredFrame` and recalculates `startPosition`
- Nudge: adjusts `anchoredFrame` proportionally via `updatePhrasePosition`

### Store (useStore.ts)
- Tracks `sampleRate` from AudioContext for accurate frame←→time conversions
- Tracks `startupDelayMs` (default 150ms) and `bufferSafetyMs` (default 100ms) for recording timing — editable in Dangerous Settings
- `updatePhrasePosition` recalculates `anchoredFrame` when clip is moved
- `headLength` per-clip metadata (0–1s, default 0.5s)
- `outputLatencyMs` and `baseLatencyMs` — set once when AudioContext is created (for display/diagnostics only), but `RecordingEngine.handleAudioWorkletStop()` reads **directly from the AudioContext** at stop time, not from the store

---

## Implementation Files

| File | Purpose |
|------|---------|
| `public/worklets/recorder.worklet.js` | AudioWorklet rolling buffer (2s) |
| `src/audio/recording/RecordingEngine.ts` | startPosition logic |
| `src/lib/multitrack/multitrack.ts` | Track management |
| `src/lib/multitrack/webaudio.ts` | WebAudioPlayer (no offset) |