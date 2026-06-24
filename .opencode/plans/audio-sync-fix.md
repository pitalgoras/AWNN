# Audio Sync Fix — Implementation Plan

## Governing Principles
- **Anchor = definitive audio start frame** from the shared AudioContext clock (no UserTime math)
- **Head** = rolling buffer prefix (configurable, default 1s). NOT pre-roll.
- **Pre-roll** = 1-bar count-in. Affects playback timing only, NOT recording capture.
- **playAt() plays everything** — head + definitive recording from buffer[0]
- **startPosition** = where the visual clip begins in UserTime (includes head)

---

## File 1: `public/worklets/recorder.worklet.js`

**Rename for clarity in `_flush()` return:**
```
return [result, this._anchoredFrame, rollingOffset];
```
- `_performanceStartFrame` → `_anchoredFrame` (same value, clearer name)
- Message field `recordingStartTime` → `anchoredFrame`

No logic change. Value already represents the shared-clock frame of punch-in.

---

## File 2: `RecordingEngine.ts`

### Change A — `handleAudioWorkletStop()` signature + anchor (line ~250)

**Current:**
```ts
private async handleAudioWorkletStop(
  audioData?: Float32Array,
  performanceStartFrame?: number
): Promise<void> {
  // ...
  const anchoredFrame = performanceStartFrame
    ? performanceStartFrame - Math.floor(userTimeAtRecording * sampleRate)
    : 0;
  const startPos = this.punchInUserTime;
```

**New:**
```ts
private async handleAudioWorkletStop(
  audioData?: Float32Array,
  anchoredFrame?: number
): Promise<void> {
  // ...
  // anchoredFrame IS the shared-clock frame — pass through, no subtraction
  const anchorFrame = anchoredFrame ?? 0;

  // startPosition in UserTime = anchor(RealTime) - secondsPerBar(→UserTime) - headLength
  const secondsPerBar = (60 / this.config.bpm) * this.config.timeSignature[0];
  const startPos = (anchorFrame / sampleRate) - secondsPerBar - this.headLength;
```

### Change B — `onAddPhrase` callback (line ~304)

**Current:**
```ts
headLength: this.headLength,
anchoredFrame: anchoredFrame,
originalAnchoredFrame: anchoredFrame,
```

**New (same structure, different `anchoredFrame` value):**
```ts
headLength: this.headLength,
anchoredFrame: anchorFrame,
originalAnchoredFrame: anchorFrame,
```

No other changes to `handleAudioWorkletStop`.

---

## File 3: `src/lib/multitrack/webaudio.ts`

### `playAt()` — simplified offset (line ~155)

**Current:**
```ts
const sampleRate = this.buffer.sampleRate
const anchorTime = this._anchoredFrame / sampleRate
const targetPosition = this.playedDuration + this._headLength
let offset = targetPosition - anchorTime
offset = Math.max(0, Math.min(offset, duration - 0.001))
```

**New:**
```ts
// Play everything from buffer start. Head is part of the clip.
// offset advances with playedDuration for seeking.
const offset = Math.max(0, Math.min(this.playedDuration, duration - 0.001))
```

`_anchoredFrame` and `_headLength` remain as stored metadata (used by Reset/Undo in TakeBar) but are no longer used in playback math.

Constructor keeps both parameters for metadata purposes:
```ts
if (options?.headLength !== undefined) {
  this._headLength = options.headLength;
}
```

### `muted` setter — fix duplicate connection (line ~256)

**Current:**
```ts
} else {
  // Only reconnect if not already connected
  if (!this.gainNode.context?.destination) {
    this.gainNode.connect(this.audioContext.destination)
  }
}
```

**Note:** This fix is already applied. The existing `if (!this.gainNode.context?.destination)` check is not reliable — `gainNode.context` always returns the AudioContext, and `.destination` is always set. Fix to:

```ts
} else {
  // Check if actually disconnected (not connected to destination)
  if (!this._isConnected) {
    this.gainNode.connect(this.audioContext.destination)
    this._isConnected = true
  }
}
```

And in `muted` setter: `this._isConnected = false` before disconnecting.

Actually — let me look at this more carefully. The `gainNode.context` getter returns the AudioContext, and `.destination` is a property of AudioContext that always exists. So `!this.gainNode.context?.destination` is always falsy (never true). The reconnection check is broken. Need a manual flag.

---

## File 4: `src/components/TakeBar.tsx`

### Reset button (line ~196)

**Current:**
```ts
const sampleRate = useStore.getState().sampleRate;
const newStartPosition = (originalAnchoredFrame / sampleRate) - selectedPhrase.headLength;
```

**New:**
```ts
const state = useStore.getState();
const sampleRate = state.sampleRate;
const beatsPerSecond = (state.bpm || 120) / 60;
const secondsPerBeat = 1 / beatsPerSecond;
const secondsPerBar = secondsPerBeat * (state.timeSignature?.[0] || 4);
const newStartPosition = (originalAnchoredFrame / sampleRate) - secondsPerBar - selectedPhrase.headLength;
```

---

## File 5: `src/store/useStore.ts`

### `updatePhrasePosition` (line ~298)

**Current (already correct, no change needed):**
```ts
const deltaFrames = Math.round(delta * sampleRate);
phrase.anchoredFrame = phrase.originalAnchoredFrame + deltaFrames;
```

This works because: when `startPosition` changes by `delta`, `anchoredFrame` changes by the same `delta * sampleRate` (the fixed `secondsPerBar + headLength` terms cancel out).

---

## File 6: `src/lib/multitrack/multitrack.ts`

### `initAudio()` (line ~188) — already applied

Non-anchored tracks get `headLength: 0`:
```ts
audio = (track.options?.media as HTMLMediaElement | WebAudioPlayer) 
      || new WebAudioPlayer(this.audioContext, { headLength: 0 });
```

### `initWavesurfer()` — remove dead code (line ~218)

Remove the old block that recreated WebAudioPlayer for anchoredFrame (lines 218-240 in current diff). Already removed in the working tree.

---

## Verification Matrix

| Scenario | `anchoredFrame` (frames) | `startPos` (UserTime) | `playAt offset` | Result |
|----------|--------------------------|----------------------|-----------------|--------|
| Record @ UserTime 5.0, HL=1.0, 120bpm/4 | floor(7.0 × 44100) = 308700 | 7.0 − 2.0 − 1.0 = **4.0** | `playedDuration` (0 at start) | Visual [4.0→], head 4.0-5.0, audio 5.0+ ✓ |
| Same, HL=0.5 | 308700 | 7.0 − 2.0 − 0.5 = **4.5** | `playedDuration` | Visual starts 0.5s later, less head ✓ |
| Reset | `originalAnchoredFrame` / sr − sPB − HL | = original startPos | — | Restores original position ✓ |
| Move +2s | anchorFrame + 2.0×44100 | startPos + 2.0 | — | Both shift, sync preserved ✓ |
| Imported audio (no anchor) | N/A | stored startPos | `playedDuration` | Normal playback ✓ |
| Metronome (HL=0, no anchor) | N/A | 0 (RealTime) | `playedDuration` | Normal playback ✓ |
| Seek mid-clip (3s in) | — | — | 3.0 | Plays from 3s in buffer ✓ |

---

## Pre-Roll Behavior

In pre-roll mode ('always'):
1. Transport seeks to −secondsPerBar (Bar 0)
2. Metronome plays count-in
3. Rolling buffer fills during pre-roll
4. At UserTime 0 (punch-in), AudioWorklet starts recording
5. Buffer contains [pre-roll audio ~1s][recording]
6. `startPosition = anchorFrame/sr − sPB − HL = (secondsPerBar/sr × sr) − sPB − 1.0 = −1.0`
7. Clip visual starts at UserTime −1.0 (during pre-roll)
8. Head of the clip = the pre-roll audio already in the buffer

The head captures the last `headLength` of whatever was playing (metronome count-in in this case). This is expected behavior — the "head" is ambient audio before the definitive recording.