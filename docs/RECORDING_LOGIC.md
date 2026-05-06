# Recording Logic & Features (audioOffset Approach)

## Current Recording Logic (audioOffset for Sync)

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

Playback (with audioOffset):
                      [  actual recording...        ]
                      ^
                      |
            Audio starts here (offset skips the 1s head)
```

1. ✅ **NO trimming** - Keep the 1s head in audio buffer
2. ✅ **Clip `startPosition = punchInUserTime`** - Timeline position (User Time)
3. ✅ **`audioOffset = -(1.0s head + latencySec)`** - Skip head during playback
4. ✅ **Purpose** - Audio stays IN SYNC with other tracks!
5. ✅ **Latency compensation = relative** - Between tracks, NOT absolute timeline position

### How audioOffset Works

**Formula**: `audioOffset = -(headDuration + latencySec)`
- `headDuration = 1.0s` (the pre-roll head we captured)
- `latencySec = (globalLatencyMs + extraLatencyMs) / 1000`

**Example**: 
- `globalLatencyMs = 131ms`, `extraLatencyMs = 0`
- `latencySec = 0.131s`
- `audioOffset = -(1.0 + 0.131) = -1.131s`

**Result**: When timeline reaches `punchInUserTime`, playback skips 1.131s into the buffer → audio is IN SYNC!

---

## Simplified Approach (ALL Cases Same)

| Case | AudioWorklet Start | Clip startPosition | audioOffset |
|------|-------------------|------------------|-------------|
| Pre-roll "always" | `punchInUserTime_Real - 1s` | `punchInUserTime` | `-(1.0s + latency)` |
| Live punch-in (playing) | `punchInUserTime_Real - 1s` | `punchInUserTime` | `-(1.0s + latency)` |
| "none" + not playing | `currentFrame` (no buffer) | `punchInUserTime` | `-(1.0s + latency)` |

**The simplification**: 
1. AudioWorklet decides when to start using its own `currentTime`
2. Start recording 1s before `punchInUserTime_Real`
3. `audioOffset` handles sync during playback

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
- AudioWorklet uses **Real Time** frames (`currentFrame`, `currentTime`) for sync
- Rolling buffer stores **Real Time** frames (`currentFrame`)
- `audioOffset` is calculated in **User Time** (seconds to skip during playback)

---

## 4 Timing Evils (How We Fight Them)

1. **Input Latency** → `globalLatencyMs` (handled)
2. **Output Latency** → `outputLatency` (handled)
3. **Recording/Playback Jitter** → AudioWorklet shared clock (already addressed)
4. **UI Delays/Startup Delay** → **Rolling buffer** (AudioWorklet, 2 seconds) - Fight by capturing continuously!

### Rolling Buffer Purpose
- **Fights startup delay** (Evil #4): By capturing continuously during playback, when user presses Record, the buffer already has audio from before the button press → no startup latency.
- **Stores Real Time frames** in AudioWorklet processor
- **Retrieval**: On `START_RECORDING`, AudioWorklet starts recording at `currentFrame` when `currentTime >= targetStartReal`

---

## AudioWorklet Implementation

### How It Works (audioOffset Approach)
```
Audio Buffer (complete):
[  1s pre-roll audio   ][  actual recording...        ]
^                        ^ 
|                        |
Recording starts here      punchInUserTime_Real

Playback (with audioOffset):
                      [  actual recording...        ]
                      ^
                      |
            Audio starts here (offset = -1.131s)
```

1. **AudioWorklet** runs continuously during playback (2-second rolling buffer)
2. **When user presses Record**: `START_RECORDING` sent with `punchInUserTime_Real`
3. **AudioWorklet decides when to start**: Uses its own `currentTime` to start 1s before `punchInUserTime_Real`
4. **NO trimming** - Keep the 1s head in audio buffer
5. **Clip `startPosition = punchInUserTime`** - Timeline position (User Time)
6. **`audioOffset = -(1.0s + latencySec)`** - Skip head during playback
7. **Result**: Audio plays IN SYNC with other tracks!

### Benefits
1. **Shared jitter**: Playback and recording drift together → stay in sync
2. **Sample-accurate timing**: `currentFrame / sampleRate` = exact AudioContext time
3. **No separate clock compensation needed** for jitter (still need #1 and #2)
4. **Startup delay eliminated** - Buffer has audio from before punch-in (timing evil #4)
5. **AudioOffset handles sync** - Skip head + compensate latency during playback

---

## Future Features

### 1. WaveSurfer Masking (Hide Pre-roll Visually)
**Location**: `src/lib/multitrack/multitrack.ts`

**Requirement**: 
- Hide the first 1s of waveform visually (the pre-roll head)
- Audio data remains in buffer (for offset/fade-in)
- Clip still appears at `punchInUserTime` (correct visual position)

**Implementation**:
1. Add CSS mask/gradient to first 1s of waveform region
2. OR use WaveSurfer region with opacity

**Status**: Postponed - audioOffset already handles sync!

---

### 2. Offset Adjustment (UI Nudge)
**Location**: UI + Store actions

**Requirement**: 
- Use the masked 1s audio to adjust clip timing
- Allow nudging the clip's audio relative to its visual position
- Example: If clip starts 50ms late, adjust `audioOffset` to `-1.05s`

**Implementation**:
1. Store `audioOffset` in phrase data (already done!)
2. UI: Drag handle to adjust offset
3. Update `WebAudioPlayer.offset` dynamically

**Status**: Postponed - core sync works with fixed offset!

---

### 3. Fade-In (Using Masked Audio)
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
| `public/worklets/recorder.worklet.js` | AudioWorklet rolling buffer (2s), decides start via `currentTime` |
| `src/audio/recording/RecordingEngine.ts` | `punchInUserTime`, `startPos = punchInUserTime`, `audioOffset` calculation |
| `src/lib/multitrack/multitrack.ts` | Uses `audioOffset` in WaveSurfer via `WebAudioPlayer` |
| `src/lib/multitrack/webaudio.ts` | `WebAudioPlayer` supports `offset` parameter |
| `docs/AUDIO_LOGIC_SPECS.md` | Updated with User/Real Time distinction |
| `docs/REFACTORING_LOG.md` | Documents AudioWorklet approach, audioOffset feature |
| `docs/RECORDING_LOGIC.md` | This file - Clean summary |

---

## Testing Checklist

- [x] Recording creates clip with duration > 1 second (not 20ms)
- [x] Clip appears at `punchInUserTime` (where Record was pressed)
- [x] NO trimming of audio data
- [x] `audioOffset` skips head + compensates latency
- [x] Audio plays IN SYNC with other tracks!
- [ ] WaveSurfer masks/hides first 1s of waveform (future)
- [x] Multiple recordings at different positions work
- [x] Pre-roll "always" → clip at `punchInUserTime` (Bar 1 = 0)
- [x] Live punch-in → clip at current playhead position
- [x] Latency compensation works (bluetooth, USB, etc.)

---

## Git History (Relevant Commits)

```
f4b742a feat: Add audioOffset support - WebAudioPlayer skip head + latency
c57a68c feat: AudioWorklet decides start via currentTime, audioOffset with latency compensation
b32e74d fix: Simplify AudioWorklet - remove recordingStartTime, use currentFrame - sampleRate
ddff309 fix: AudioWorklet event reference bug - store recordingStartTime in class property
3a3eb32 fix: Recording 1s head + temp startPos=punchInUserTime-1s + comments + docs
a9a6976 fix: Read currentTime from store in startRecording() to avoid stale config
9519804 Clean up useAudioEngine by removing unused refs and functions
```
