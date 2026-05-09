# Recording Logic & Features

## Terminology

| Term | Definition |
|------|-------------|
| **Rolling buffer** | 2-second continuous capture in AudioWorklet, always active during playback |
| **Capture** | The AudioWorklet's act of recording into rolling buffer |
| **Recording** | Final saved audio (includes head if present) |
| **Head** | Audio already in rolling buffer (~1s) when user presses Record - VALID pre-punch-in audio |
| **Pre-roll** | 1 bar (2s at 120 BPM) of PLAYBACK before punch-in - for timing, NOT recording |

---

## States Table

| # | Pre-roll mode | State when Record pressed | Head? | startPosition | audioOffset |
|---|--------------|--------------------------|------|---------------|-------------|
| 1 | always | STOPPED | YES | punchInTime - headLength | NO |
| 2 | always | PLAYING | YES | punchInTime - headLength | NO |
| 3 | none | STOPPED | YES | punchInTime - headLength | NO |
| 4 | none | PLAYING | YES | punchInTime - headLength | NO |

**For ALL states:**
- `startPosition = punchInTime - headLength`
- `audioOffset = NO` (not needed - WaveSurfer plays from startPosition which matches audio position)

### Where:
- **headLength**: Duration of audio already captured in rolling buffer when Record pressed
- When Stopped: Rolling buffer always has ~1s of audio → head captured
- When Playing: Recording starts early → rolling buffer provides head from recent audio

---

## How It Works

### Recording Flow
1. Rolling buffer captures continuously during playback
2. User presses Record at punchInTime
3. Recording captures from rolling buffer which has headLength of audio BEFORE punchInTime
4. Saved audio buffer = [head][actual recording...]
5. Visual clip starts at `punchInTime` in timeline

### Playback Flow
1. User plays timeline
2. WaveSurfer reaches startPosition (punchInTime - headLength)
3. Audio starts from buffer position 0 = headLength offset from punchInTime
4. Audio plays IN SYNC with timeline!

### Key Insight
Visual position + audio buffer position work together:
- `startPosition` tells WaveSurfer where to show the clip
- `startPosition` also tells WaveSurfer where to START audio in the buffer
- No separate offset calculation needed!

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
- Calculate `punchInUserTime` when Record pressed
- Set `startPosition = punchInUserTime - headLength` for all states
- Set `audioOffset = 0` (not needed)

### multitrack.ts / WebAudioPlayer
- Use `startPosition` from track as both visual position AND playback start position
- No audioOffset passed = plays from buffer start = matches headLength offset automatically

---

## Implementation Files

| File | Purpose |
|------|---------|
| `public/worklets/recorder.worklet.js` | AudioWorklet rolling buffer (2s) |
| `src/audio/recording/RecordingEngine.ts` | startPosition logic |
| `src/lib/multitrack/multitrack.ts` | Track management |
| `src/lib/multitrack/webaudio.ts` | WebAudioPlayer (no offset) |