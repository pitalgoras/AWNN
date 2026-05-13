# Audio Engine & Sync System — Change Log

## Overview
This iteration replaced the old `MediaRecorder`-based recording with a mandatory `AudioWorklet` architecture, implemented per-clip anchored frame sync, fixed metronome playback, and added head-length-aware playback offset calculations.

---

## 1. RecordingEngine (`src/audio/recording/RecordingEngine.ts`)

### What changed
- **Removed `MediaRecorder` entirely** — `continuousRecorder`, `audioChunks`, `recorderStartTime`, `useAudioWorklet` flag, and all fallback logic deleted.
- **AudioWorklet is now mandatory.** If `AudioWorklet` is not supported, an error is thrown.
- **Added `headLength` getter** (defaults to `1.0s`) for the rolling buffer pre-roll.

### New `initAudioWorklet()` (line 169)
- Resumes `AudioContext` if suspended **before** loading the module (line 185-187).
- Catches `addModule` if already registered (returns `"already been added"` DOMException), allowing second recording attempts without crash.
- Creates `AudioWorkletNode` with `sampleRate` and `headLength` in `processorOptions`.
- Sets up continuous mic→worklet→silentGain→destination routing.

### `handleAudioWorkletStop()` (line 250)
- Receives `[audioData, performanceStartFrame]` from worklet's `_flush()`.
- Computes **`anchoredFrame`** = `performanceStartFrame - Math.floor(userTimeAtRecording * sampleRate)`.
- Passes `anchoredFrame`, `originalAnchoredFrame`, and `headLength` to `onAddPhrase` callback.
- Fixed: `onSetIsRecording(false)` now called **after** phrase creation (was accidentally removed earlier).
- Fixed: `activeTrackId` cleanup happens after phrase is fully stored.

### `startRecording()` (line 323)
- Computes `punchInUserTime` from `audioContext.currentTime` (if playing) or store `currentTime` (if stopped).
- `punchInUserTime_Real` calculated just before message post for sample-accurate sync.
- Sends `START_RECORDING` message with `punchInUserTime_Real` and `captureImmediately` flag.
- Rolling buffer primed with 1s wait when recording from stopped state with `preRollMode === 'none'`.

### Removed
- `handleRecorderStop()` (old MediaRecorder path) — entire function deleted.
- `startContinuousRecorder()` — deleted.
- `cancelRecording()` — simplified to just post `STOP_RECORDING` + set flag.

---

## 2. Worklet (`public/worklets/recorder.worklet.js`)

### Key behaviors
- **Rolling buffer**: 2-second ring buffer that always captures audio (pre-roll head).
- **`START_RECORDING` message**: Sets `_performanceStartFrame = Math.floor(punchInUserTime_Real * sampleRate)`, starts recording immediately.
- **`_flush()` on stop**: Prepends rolling buffer data (pre-roll head) to recorded data, returns `[combinedData, performanceStartFrame, rollingOffset]`.
- `_rollingBufferDuration = Math.max(2.0, headLength + 1.0)` — always larger than head length.

---

## 3. WebAudioPlayer (`src/lib/multitrack/webaudio.ts`)

### New properties
- `_headLength` (default `1.0`) — head length in seconds for offset calculation.
- `_anchoredFrame` — frame offset from UserTime 0 at recording time.

### New `playAt()` offset formula (line 140)
```
anchorTime      = anchoredFrame / sampleRate      // Where clip starts in timeline time
targetPosition  = playedDuration + headLength      // Where playback head should be relative to clip
offset          = targetPosition - anchorTime       // Seek position into buffer
```
- Clamped to `[0, duration - 0.001]`.
- For **metronome** tracks: `headLength=0`, `anchoredFrame=0` → `offset = playedDuration` (plays from wherever playback position is).
- For **recorded** tracks: `headLength=1.0`, `anchoredFrame=N` → skips the head portion and starts at the right timeline position.

### Fixed `muted` setter
- Now checks `!this.gainNode.context?.destination` before reconnecting to avoid duplicate connections.

---

## 4. MultiTrack (`src/lib/multitrack/multitrack.ts`)

### `initAudio()` (line 181)
- **Anchored tracks** (`anchoredFrame !== undefined && !== 0`): Creates `WebAudioPlayer` with `anchoredFrame` and `headLength` (default 1.0).
- **Non-anchored tracks** (metronome, imported audio): Creates `WebAudioPlayer` with **`headLength: 0`** — plays from buffer start with no skip.
- Removed old `audioOffset` property and the hack that recreated `WebAudioPlayer` on each `initWavesurfer()` call.

### `updatePosition()` (line 425)
- Uses `time - track.startPosition` to get position within each track's audio.
- Calls `webaudio.playAt(startTime)` for WebAudioPlayer instances.

### `prevFadeInEnd` / `prevFadeOutStart`
- Moved from local variables in `initWavesurfer()` to instance properties (`this.prevFadeInEnd`, `this.prevFadeOutStart`) to persist across calls.

### `addTrack()` 
- Added else-branch warning when track ID not found.

---

## 5. Store (`src/store/useStore.ts`)

### New `sampleRate` field
- Default `44100`, updated when AudioContext is created.
- Used by `SyncTool` Reset and `updatePhrasePosition` for anchor math.

### `addPhrase()` 
- Copies `phrase.anchoredFrame` to `track.anchoredFrame` so multitrack picks it up on next rebuild.

### `updatePhrasePosition()` (line 284)
- **When clip moves**: Recalculates `anchoredFrame = originalAnchoredFrame + Math.round(delta * sampleRate)`.
- This preserves sync when a clip is nudged — the anchor shifts proportionally with the position change.
- Envelope nodes within the phrase's time range are also shifted.

---

## 6. useAudioEngine (`src/hooks/useAudioEngine.ts`)

### AudioContext initialization
- Async IIFE with `disposed` flag and `try/catch` to prevent silent hangs.
- AudioContext resume is **fire-and-forget** (`.catch(() => {})`) to avoid blocking init.
- `sampleRate` stored in store via `setSampleRate()`.

### Multitrack initialization
- Wrapped in `disposed`-guarded async function so cleanup race conditions are avoided.
- `metronome ? p.startPosition : p.startPosition + secondsPerBar + offset` — metronome stays in RealTime; other tracks shift by pre-roll.

### `addPhrase` callback
- Directly updates `track.anchoredFrame` and calls `multitrack.addTrack()` to bypass store re-render lag.

### `playPause()`
- Resumes AudioContext on user gesture before toggling.

---

## 7. SyncTool (`src/components/SyncTool.tsx`)

### Reset button
- Uses `sampleRate` from store (was hardcoded `44100`).
- Formula: `newStartPosition = (originalAnchoredFrame / sampleRate) - headLength`.

### Head length input
- Editable per-clip (0–1, step 0.1). Stored on the phrase, used during playback offset calculation.

---

## 8. Metronome Timing (no code change needed)

The metronome works correctly with the following data flow:
- `MetronomeEngine.generateClickTrackBuffer()` places first click at sample 0 (RealTime 0 = UserTime `-secondsPerBar`).
- Timeline `formatTimeCallback` subtracts `secondsPerBar` to display UserTime.
- Metronome `realStartPosition = 0` (RealTime), no anchor, `headLength = 0`.
- On playback, `playAt()` computes `offset = playedDuration + 0 - 0 = playedDuration`.
- Result: clicks land at exact beat positions on the timeline.

---

## Data Flow Summary

```
Recording:
  User clicks Record
  → RecordingEngine.startRecording(trackId)
  → initStream() → initAudioWorklet() (loads module, creates node)
  → Worklet receives START_RECORDING with punchInUserTime_Real
  → Worklet records to rolling buffer + _audioData
  → User clicks Stop
  → Worklet _flush() prepends rolling buffer, returns [data, performanceStartFrame]
  → handleAudioWorkletStop(audioData, performanceStartFrame)
  → anchoredFrame = performanceStartFrame - floor(userTime * sampleRate)
  → onAddPhrase({ url, audioBuffer, startPosition, headLength, anchoredFrame, originalAnchoredFrame })
  → store.addPhrase() → track.anchoredFrame = phrase.anchoredFrame

Playback:
  multitrack.updatePosition(time)
  → newTime = time - track.startPosition
  → webaudio.playAt(startTime)
    → anchorTime = anchoredFrame / sampleRate
    → targetPosition = playedDuration + headLength
    → offset = targetPosition - anchorTime
    → bufferNode.start(startTime, offset)

Reset (SyncTool):
  newStartPosition = (originalAnchoredFrame / sampleRate) - headLength
  → restores original anchor + head length alignment

Move (nudge):
  updatePhrasePosition(trackId, phraseId, newPosition)
  → delta = newPosition - oldPosition
  → anchoredFrame = originalAnchoredFrame + round(delta * sampleRate)
```