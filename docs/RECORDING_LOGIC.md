# Recording Logic & Features

## Terminology

| Term | Definition |
|------|-------------|
| **Rolling buffer** | 2-second continuous capture in AudioWorklet, always active during playback |
| **Capture** | The AudioWorklet's act of recording into `_audioData` |
| **Recording** | Final saved audio (includes head if present) |
| **Head** | Audio already in rolling buffer (up to `headLength` seconds) when definitive recording starts — prepended as prefix of the saved clip. The worklet's `_flush()` trims the rolling buffer to exactly `headLength` seconds. |
| **Pre-roll** | 1 bar (2s at 120 BPM) of PLAYBACK before punch-in — for timing, NOT recording |
| **Anchor (anchoredFrame)** | AudioContext clock frame number from `punchInUserTime_Real × sampleRate`, marking where definitive audio starts. Source of truth for sync, Reset, and Undo. |
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
3. `punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn` computed for AudioWorklet sync
4. AudioWorklet starts, using `punchInUserTime_Real` to set `_anchoredFrame`. Rolling buffer data provides the head, trimmed to exactly `headLength` seconds by `_flush()`.
5. Saved audio buffer = `[head ~headLength s][definitive recording...]`
6. `startPosition = punchInUserTime − headLength` places the visual clip directly from UserTime

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
- Calculate `punchInUserTime` when Record pressed (UserTime)
- `punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn` (AudioContext clock)
- Send `punchInUserTime_Real` to AudioWorklet via message
- Worklet computes `_anchoredFrame = Math.floor(punchInUserTime_Real × sampleRate)` and returns it as `anchoredFrame`
- `startPosition = punchInUserTime − headLength` (direct UserTime, independent of anchorFrame)

### WebAudioPlayer (webaudio.ts)
- Stores `_anchoredFrame` and `_headLength` as metadata
- `playAt()`: offset = `playedDuration` (plays entire buffer from position 0)
- Moving a clip updates `anchoredFrame` relative to `originalAnchoredFrame`
- Reset restores `originalAnchoredFrame` and recalculates `startPosition`

### MultiTrack (multitrack.ts)
- Anchored tracks: creates `WebAudioPlayer` with `{ anchoredFrame, headLength }`
- Non-anchored tracks (metronome): creates `WebAudioPlayer` with `{ headLength: 0 }`

### SyncTool.tsx
- Head length input: editable per-clip (0–1s, step 0.1)
- Reset button: restores `originalAnchoredFrame` and recalculates `startPosition`
- Nudge: adjusts `anchoredFrame` proportionally via `updatePhrasePosition`

### Store (useStore.ts)
- Tracks `sampleRate` from AudioContext for accurate frame←→time conversions
- Tracks `startupDelayMs` (default 150ms) and `bufferSafetyMs` (default 100ms) for recording timing — editable in Dangerous Settings
- `updatePhrasePosition` recalculates `anchoredFrame` when clip is moved
- `headLength` per-clip metadata (0–1s, default 1.0s)

---

## Implementation Files

| File | Purpose |
|------|---------|
| `public/worklets/recorder.worklet.js` | AudioWorklet rolling buffer (2s) |
| `src/audio/recording/RecordingEngine.ts` | startPosition logic |
| `src/lib/multitrack/multitrack.ts` | Track management |
| `src/lib/multitrack/webaudio.ts` | WebAudioPlayer (no offset) |