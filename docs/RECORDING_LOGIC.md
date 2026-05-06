# Recording Logic & Future Features (Clean Summary)

## Current Recording Logic (Simplified, No Trimming)

### The Concept
```
Audio Buffer (complete):
[  1s pre-roll audio   ][  actual recording...        ]
^                        ^ 
|                        |
punchInUserTime - 1s      punchInUserTime (User Time)

Visual Clip (what user sees):
                     [  actual recording...        ]
                     ^
                     |
              punchInUserTime (startPosition)

MASKED/HIDDEN: [  1s pre-roll] (kept in buffer for offset/fade-in)
```

1. ✅ **NO trimming** - Keep the 1s head in audio buffer
2. ✅ **Clip `startPosition = punchInUserTime`** - Timeline position (User Time)
3. ✅ **WaveSurfer masking** - Hide the first 1s visually
4. ✅ **Purpose** - Allow future offset adjustment or fade-in using masked audio
5. ✅ **Latency compensation = relative** - Between tracks, NOT absolute timeline position

### Simplified Approach (ALL Cases Same)

| Case | AudioWorklet Start | Clip startPosition |
|------|-------------------|------------------|
| Pre-roll "always" | `punchInUserTime - 1s` | `punchInUserTime` |
| Live punch-in (playing) | `punchInUserTime - 1s` | `punchInUserTime` |
| "none" + not playing | `currentFrame` (no buffer yet) | `punchInUserTime` |

**The simplification**: Always record from `punchInUserTime - 1 second`. No complex pre-roll logic!

---

## User Time vs Real Time (CRITICAL DISTINCTION)

| Concept | User Time (Timeline) | Real Time (AudioContext) |
|---------|----------------------|--------------------------|
| **Definition** | Timeline position (Bar 1 = 0) | `audioContext.currentTime` (since creation) |
| **Example** | `punchInUserTime = 0` (Bar 1) | `audioContext.currentTime = 6.93s` |
| **Bar 0** | Negative (e.g., -2s) | N/A |
| **Used For** | `startPosition`, timeline display | AudioWorklet frames, WebAudio API |
| **Variable** | `punchInUserTime` | `currentFrame`, `startFrame` |

**Key Rules**:
- `punchInUserTime` is **User Time** → used for `startPosition` (where clip appears on timeline)
- `startFrame` sent to AudioWorklet is **Real Time** (frame number = `currentFrame` or calculated from `audioContext.currentTime`)
- Rolling buffer stores **Real Time** frames (`currentFrame`)
- When retrieving from buffer: `startFrame` must be a valid **Real Time** frame (≥ 0 and ≤ `currentFrame`)

---

## 4 Timing Evils (How We Fight Them)

1. **Input Latency** → `globalLatencyMs` (handled)
2. **Output Latency** → `outputLatency` (handled)
3. **Recording/Playback Jitter** → AudioWorklet shared clock (already addressed)
4. **UI Delays/Startup Delay** → **Rolling buffer** (AudioWorklet, 2 seconds) - Fight by capturing continuously!

### Rolling Buffer Purpose
- **Fights startup delay** (Evil #4): By capturing continuously during playback, when user presses Record, the buffer already has audio from before the button press → no startup latency.
- **Stores Real Time frames** in AudioWorklet processor
- **Retrieval**: On `START_RECORDING`, audio starts from `currentFrame - sampleRate` (1s before punch-in)

---

## Future Features

### 1. Offset Adjustment
**Location**: UI + Store actions

**Requirement**: 
- Use the masked 1s audio to adjust clip timing
- Allow nudging the clip's audio relative to its visual position
- Example: If clip starts 100ms late, adjust offset to -0.1s

**Implementation**:
1. Store `audioOffset` in phrase data (default 0)
2. WaveSurfer plays from `startPosition + audioOffset`
3. UI: Drag handle to adjust offset

**Status**: Postponed - nice-to-have after core recording works.

---

### 2. Fade-In (Using Masked Audio)
**Location**: Audio processing + WaveSurfer rendering

**Requirement**: 
- Apply fade to the first 1s (which is masked visually)
- User can choose fade duration (0.5s, 1s, etc.)
- Uses the masked audio (no need to re-record)

**Implementation**:
1. In `handleAudioWorkletStop()`: Apply linear fade-in to first N samples
2. Or apply via WaveSurfer region rendering (CSS opacity gradient?)
3. Store fade-in duration in phrase data

**Status**: Postponed - nice-to-have after core recording works.

---

## Implementation Files

| File | Purpose |
|------|---------|
| `public/worklets/recorder.worklet.js` | AudioWorklet rolling buffer (2s), Real Time frames |
| `src/audio/recording/RecordingEngine.ts` | `punchInUserTime`, `startPos = punchInUserTime`, NO trimming |
| `src/lib/multitrack/multitrack.ts` | WaveSurfer masking, region `start = punchInUserTime` |
| `docs/AUDIO_LOGIC_SPECS.md` | Updated with User/Real Time distinction |
| `docs/REFACTORING_LOG.md` | Documents AudioWorklet approach, future features |
| `docs/RECORDING_LOGIC.md` | This file - Clean summary |

---

## Testing Checklist

- [ ] Recording creates clip with duration > 1 second (not 20ms)
- [ ] Clip appears at `punchInUserTime` (where Record was pressed)
- [ ] NO trimming of audio data
- [ ] WaveSurfer masks/hides first 1s of waveform
- [ ] Audio plays correctly (includes 1s pre-roll)
- [ ] Multiple recordings at different positions work
- [ ] Pre-roll "always" → clip at Bar 1 (punchInUserTime = 0)
- [ ] Live punch-in → clip at current playhead position
