# Sync Fix Plan — Option B

## Root Cause

The `playAt()` offset formula double-counts the timeline offset:

```
// CURRENT (BROKEN):
anchorTime = anchoredFrame / sampleRate  
// anchoredFrame = performanceStartFrame - (userTime * sampleRate)
// performanceStartFrame = (userTime + secondsPerBar) * sampleRate
// So: anchorTime = secondsPerBar ≈ 2.0

offset = playedDuration + headLength - anchorTime
// At clip start: offset = 0 + 1.0 - 2.0 = -1.0 → clamped to 0
// Clamped to 0 = plays pre-roll garbage, not actual recording!
```

The multitrack already handles UserTime→RealTime conversion via `startPosition + secondsPerBar`. The worklet's `performanceStartFrame` includes that same offset. Subtracting it again in `playAt()` is double-counting.

## Changes Required

### 1. `RecordingEngine.ts` — `handleAudioWorkletStop()` (line ~280)
- `anchoredFrame`: Change to `Math.floor(userTimeAtRecording * sampleRate)` (remove `performanceStartFrame` subtraction)
- `startPos`: Change to `this.punchInUserTime - this.headLength`

### 2. `webaudio.ts` — `playAt()` (line ~155)
- New formula: `offset = this.playedDuration + this._headLength`
- Drop `anchorTime` from calculation entirely
- Still clamp to `[0, duration - 0.001]`

### 3. `recorder.worklet.js` — `_flush()` (line ~182)
- Include `rollingOffset` (actual bytes of head prepended) in return message so engine knows real head length

### 4. `useAudioEngine.ts` — `onAddPhrase` callback (line ~120)
- Use `rollingOffset / sampleRate` as actual headLength if returned from worklet, falling back to config headLength

### 5. `SyncTool.tsx` — Reset button
- No change needed. Current formula `originalAnchoredFrame / sampleRate - headLength` works correctly since anchoredFrame will now store `floor(userTime * sampleRate)`.

### 6. `multitrack.ts` — `initAudio()` (line ~189)
- Already fixed: non-anchored tracks (metronome) get `headLength: 0`

## Verification Matrix

| Scenario | playedDuration | headLength | offset | Result |
|----------|---------------|------------|--------|--------|
| Clip start (post-stop recording) | 0 | 1.0 | 1.0 | Skips head, plays actual audio ✓ |
| Mid-clip seek | 3.5 | 1.0 | 4.5 | Plays from 4.5s in buffer ✓ |
| Metronome (HL=0) | any | 0 | playedDuration | Normal playback ✓ |
| Pre-roll recording | 0 | ~0* | ~0 | *Uses rollingOffset for accuracy |

## Pre-Roll Question (for user)

In pre-roll mode, the rolling buffer barely fills before recording starts. Actual head may be <0.5s instead of 1.0s. Two options:

- **A**: Use worklet's `rollingOffset` as actual headLength (most accurate)
- **B**: Accept the gap — pre-roll recordings intentionally capture backing track audio before punch-in

Recommend option A — the worklet already tracks `rollingOffset` and can return it.