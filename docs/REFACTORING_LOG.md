# Refactoring Log - Audio Engine Modularization

## Overview
Modular refactoring of `useAudioEngine.ts` (1200+ lines) into separate modules for better maintainability.

**Date**: May 2026  
**Commits**: 39f570a → 9519804

---

## Modules Created

### 1. `src/audio/recording/RecordingEngine.ts`
Encapsulates all recording logic:
- Continuous recorder pattern (mic latency elimination + circular buffer for pre-roll)
- Session ID system to prevent stale `handleRecorderStop` calls
- Pre-roll calculation and audio trimming
- Phrase creation with proper startPosition

### 2. `src/audio/metronome/MetronomeEngine.ts`
Encapsulates metronome logic:
- Click track generation
- BPM/time signature management
- Metronome phrase creation

### 3. `src/lib/audio/LatencyCalibrator.ts`
Shared latency calibration logic (extracted from component).

### 4. Audio Utilities (`src/audio/processing/`, `src/audio/time/`, `src/audio/project/`)
- `audioBufferToWav.ts` - WAV conversion
- `audioUtils.ts` - Peak calculation, audio processing
- `timeUtils.ts` - Time formatting, bar calculations
- `projectPersistence.ts` - Project save/load

---

## AudioWorklet Recording (Shared Clock) - Current Implementation

### Why AudioWorklet?
- **MediaRecorder**: Uses its own clock, NOT synchronized with AudioContext
- **AudioWorklet**: Runs on audio render thread, uses **same `currentTime`** as playback
- From MDN: *"Returns a double that represents the ever-increasing context time of the audio block being processed. It is equal to the currentTime property of the BaseAudioContext the worklet belongs to."*

### Implementation Files
- **Processor**: `public/worklets/recorder.worklet.js`
- **Engine Support**: `src/audio/recording/RecordingEngine.ts` (AudioWorklet mode)
- **Fallback**: MediaRecorder if AudioWorklet not supported

### How It Works (Simplified, No Trimming)
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

1. **AudioWorklet** runs continuously during playback (2-second rolling buffer)
2. **When user presses Record**: Audio buffer already has audio from 1s before punch-in
3. **NO trimming** - Keep the 1s head in audio buffer
4. **Clip `startPosition = punchInUserTime`** - Timeline position (User Time)
5. **WaveSurfer masking** - Hide the first 1s of waveform visually
6. **Purpose** - Allow future offset adjustment or fade-in using masked audio

### Benefits
1. **Shared jitter**: Playback and recording drift together → stay in sync
2. **Sample-accurate timing**: `currentFrame / sampleRate` = exact AudioContext time
3. **No separate clock compensation needed** for jitter (still need #1 and #2)
4. **Startup delay eliminated** - Buffer has audio from before punch-in (timing evil #4)

### Still Needed: Latency Compensation (#1 and #2)
Even with AudioWorklet, we still apply:
```typescript
const latencyMs = this.config.globalLatencyMs + this.config.extraLatencyMs;
const latencySec = latencyMs / 1000;
// NOTE: latency compensation is RELATIVE between tracks, NOT absolute timeline position
// startPos = punchInUserTime (NOT subtracting latencySec)
```

### User Time vs Real Time (CRITICAL DISTINCTION)
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

## Problems Encountered

### Problem 1: AudioContext Synchronization Bug
**Symptom**: `TypeError: can't access property "createBuffer", this.audioContext is null`

**Root Cause**: 
- `RecordingEngine` stored `audioContext` as a value in constructor: `this.audioContext = config.audioContext`
- `updateConfig()` updated `this.config.audioContext` but NEVER updated `this.audioContext`
- `handleRecorderStop` used stale `this.audioContext` which became null

**Fix** (commit pending):
- Changed `RecordingConfig.audioContext` to `audioContextRef: React.RefObject<AudioContext | null>`
- `RecordingEngine` now accesses `this.config.audioContextRef.current` directly (matches original pattern)
- Removed `private audioContext` field from class
- Removed code that created new AudioContext in `handleRecorderStop` (original throws error instead)

**Lesson**: When extracting to modules, pass React refs as refs (not values) to avoid staleness.

---

### Problem 2: Index Mismatch in useAudioEngine.ts:410
**Symptom**: `TypeError: multitrackItems[i] is undefined`

**Root Cause**:
- `multitrackItems` array has per-phrase entries (multiple clips per track)
- `wavesurfers` array has per-track entries (one per track)
- Using index `i` to access both arrays fails when tracks have multiple phrases

**Fix** (commit 9519804):
- Match wavesurfers to multitrackItems by `trackId` instead of index
- Iterate multitrackItems, find corresponding wavesurfer by trackId

---

### Problem 3: Duplicate `startContinuousRecorder()` Calls
**Symptom**: `handleRecorderStop` fired at ~87ms (too fast), creating empty/short phrases

**Root Cause**:
- `initStream()` called `startContinuousRecorder()` (correct - user explained this is needed)
- `startRecording()` also called `startContinuousRecorder()` 
- Stopping old recorder fired `onstop` → `handleRecorderStop` with stale data

**Fix** (commit 9519804):
- Session ID system: increment `recordingSessionId` on `startRecording()`
- Capture sessionId in closure at `mediaRecorder.onstop`
- Check sessionId at start of `handleRecorderStop` - return immediately if stale
- `handleRecorderStop` now fires multiple times but stale calls are ignored

---

### Problem 4: Pre-Roll Not Working
**Symptom**: Recording started without 1-bar count-in

**Root Cause**:
- `startRecording()` in `RecordingEngine` had `preRollMode` hardcoded to `'none'`
- Store value `preRollMode` was not being passed correctly

**Fix** (commit 21e002a):
- Pass `preRollMode` from store to `RecordingEngine` via config
- Also pass `currentTime` for pre-roll calculation
- `effectivePreRollMode = isCurrentlyPlaying ? 'none' : preRollMode`

---

## Architecture Understanding

### Continuous Recorder Pattern
**Purpose**: Serves TWO functions:
1. **Eliminate mic latency**: Microphone is always "hot" (warmed up)
2. **Circular buffer for pre-roll**: Last N seconds of audio available when punch-in happens

**Flow**:
1. AudioWorklet runs continuously during playback (2-second rolling buffer)
2. Records from `currentFrame - sampleRate` (1s before punch-in)
3. NO trimming - keep 1s pre-roll in buffer
4. Clip `startPosition = punchInUserTime` (User Time)
5. WaveSurfer masks first 1s visually (hidden, but audio kept for offset/fade-in)

### Bar 0 = Pre-Roll Only
**Definition**: Bar 0 is "Real Time" 0 to `secondsPerBar`, NOT visible in normal UI.

**User Time vs Real Time**:
- **Real Time**: Actual seconds from start of project (Bar 0 = 0s to `secondsPerBar`)
- **User Time**: Shifted by `+secondsPerBar` (Bar 1 = 0s)
- **Phrases store**: `startPosition` in User Time
- **Timeline**: Hides Bar 0 unless recording (pre-roll active)

**Pre-Roll Flow**:
1. User presses Record at Bar 2 (User Time = `secondsPerBar` to `2*secondsPerBar`)
2. Transport seeks to Bar 0 (Real Time = 0)
3. Metronome plays 1 bar count-in (Bar 0)
4. At Bar 1, recording punches in (Real Time = `secondsPerBar`)
5. Phrase created with `startPosition = User Time of punch-in - latency`

### Session ID System
**Problem**: `MediaRecorder.onstop` fires asynchronously. If user starts new recording quickly, old `onstop` handler fires with stale data.

**Solution**:
```typescript
// In startRecording():
this.recordingSessionId++;  // Increment
const sessionId = this.recordingSessionId;

// In startContinuousRecorder():
mediaRecorder.onstop = () => {
  const capturedSessionId = sessionId;  // Capture in closure
  this.handleRecorderStop(capturedSessionId, trackId);
};

// In handleRecorderStop(sessionId):
if (sessionId !== this.recordingSessionId) {
  return;  // Stale call, ignore
}
```

---

## The 4 Timing Evils (Critical Understanding)

When recording audio in the browser, there are **4 separate timing problems** that each need their own solution:

### 1. Input Latency (Mic → System)
- **Problem**: Sound hitting mic → system receiving it (hardware/firmware delay)
- **Solution**: `globalLatencyMs` compensation in `startPosition` calculation
- **Value**: Typically 100-200ms depending on hardware

### 2. Output Latency (System → Speaker)
- **Problem**: System playing sound → user hearing it (DAC/amp/speaker delay)
- **Solution**: `outputLatency` used in visual sync (`currentTime - outputLatency`)
- **Value**: Typically 10-50ms

### 3. Recording/Playback Jitter (Timing Instability)
- **Problem**: WebAudio API timing isn't perfectly stable - CPU spikes, main thread blocking cause timing to drift
- **Solution**: **AudioWorklet recording** (shares AudioContext's clock with playback)
- **Benefit**: Symmetric jitter - if playback drifts, recording drifts equally → stays in sync
- **Implementation**: `public/worklets/recorder.worklet.js` + `RecordingEngine.ts` AudioWorklet support

### 4. UI Delays (Graphics + Data Capture)
- **Problem**: Browser UI rendering, React re-renders, main thread blocking affect timing
- **Solution**: Separate issue, affects UI feedback not audio sync
- **Mitigation**: Performance optimizations, debouncing, throttling

**Key Insight**: AudioWorklet solves #3 by sharing the same clock (and jitter) between playback and recording.

---

## AudioWorklet Recording (Shared Clock)

### Why AudioWorklet?
- **MediaRecorder**: Uses its own clock, NOT synchronized with AudioContext
- **AudioWorklet**: Runs on audio render thread, uses **same `currentTime`** as playback

From MDN: *"Returns a double that represents the ever-increasing context time of the audio block being processed. It is equal to the currentTime property of the BaseAudioContext the worklet belongs to."*

### Implementation Files
- **Processor**: `public/worklets/recorder.worklet.js`
- **Engine Support**: `src/audio/recording/RecordingEngine.ts` (AudioWorklet mode)
- **Fallback**: MediaRecorder if AudioWorklet not supported

### How It Works
```
getUserMedia() → mic MediaStream
    ↓
audioContext.createMediaStreamSource(micStream) → connects mic INTO AudioContext
    ↓
AudioWorkletNode with 'recorder-worklet' processor
    ↓
process(inputs, outputs) receives samples + has currentTime (AudioContext's clock)
    ↓
this.port.postMessage() sends samples to main thread
    ↓
handleAudioWorkletStop() processes data (same clock as playback)
```

### Benefits
1. **Shared jitter**: Playback and recording drift together → stay in sync
2. **Sample-accurate timing**: `currentFrame / sampleRate` = exact AudioContext time
3. **No separate clock compensation needed** for jitter (still need #1 and #2)

### Still Needed: Latency Compensation (#1 and #2)
Even with AudioWorklet, we still apply:
```typescript
const latencyMs = this.config.globalLatencyMs + this.config.extraLatencyMs;
const latencySec = latencyMs / 1000;
startPos = this.recordingStartTransportTime - latencySec;
```

---

### Problem 5: Recording Has 1 BAR Head (Not 1 Second)
**Symptom**: Recording captures entire pre-roll bar (~2.08s at 115 BPM) + 1s head = 2+ seconds of head.

**Root Cause**: 
- `START_RECORDING` sent immediately (at pre-roll start)
- AudioWorklet received it early, recorded from `currentFrame - sampleRate`
- Result: Recording starts at beginning of pre-roll (too early)

**Fix** (commit b32e74d):
- AudioWorklet decides when to start using its own `currentTime`
- Start recording when `currentTime >= targetStartReal` (1s before `punchInUserTime_Real`)
- No delays from main thread

---

### Problem 6: Audio Out of Sync — RESOLVED (anchorFrame approach)

**Symptom**: Recorded audio played out of sync with other tracks.

**Root Cause**:
1. No mechanism to communicate the definitive audio start frame between worklet and main thread
2. Previous `audioOffset` approach used time→frame conversions that lost precision to jitter
3. `startPosition = punchInUserTime` did not account for the head buffer prefix

**Fix** (anchorFrame approach):
- **`anchoredFrame`** = `Math.floor(punchInUserTime_Real × sampleRate)` from AudioWorklet (punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn, in AudioContext clock frame space)
- **`startPosition`** = `punchInUserTime − headLength` (direct UserTime computation, not derived from anchoredFrame — avoids drift from AudioContext clock delays)
- **`playAt()`** plays entire buffer from position 0 — head + definitive recording sequentially
- **Move/Undo** use `originalAnchoredFrame` as ground truth, adjusted by `delta × sampleRate`
- **`_flush()`** trims head to exactly `headLength` seconds from single rolling buffer (no `_audioData`)
- **`startupDelay`** (150ms) + `bufferSafety` (100ms) named constants, editable in Dangerous Settings
- **`punchInUserTime`** for `isCurrentlyPlaying` uses `storeState.currentTime` (not `audioCtx.currentTime - sPB`) — fixes clip-in-future bug when recording while playing

**Result**: Audio plays in perfect sync with other tracks. Frame-based math ensures jitter resistance.

---

### Problem 7: AudioWorklet Event Reference Bug
**Symptom**: `ReferenceError: event is not defined` in AudioWorklet.

**Root Cause**: 
- `event.data.recordingStartTime` accessed in `process()` method
- `event` only defined in `onmessage` handler (different scope)

**Fix** (commit ddff309):
- Store `recordingStartTime` in class property `this._recordingStartTime`
- Use `this._recordingStartTime` in `process()` method
- Simplified: Removed `recordingStartTime` approach entirely, use `currentFrame - sampleRate`

---

## Recent Changes (anchorFrame Migration — May 2026)

### What Changed
1. ✅ **AudioWorklet mandatory** — `MediaRecorder` fallback removed entirely
2. ✅ **`anchoredFrame`** = `Math.floor(punchInUserTime_Real × sampleRate)` — AudioContext clock frame via `punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn`
3. ✅ **`startPosition = punchInUserTime − headLength`** — visual clip computed directly from UserTime, independent of anchorFrame
4. ✅ **`playAt()` offset = `playedDuration`** — plays entire buffer (head + recording)
5. ✅ **`headLength` per clip** — editable in TakeBar, stored on phrase at recording time. Single-buffer approach: rolling buffer stops trimming at `_recordingStartFrame`; `_flush()` extracts head + recording from one buffer, no `_audioData`.
6. ✅ **`originalAnchoredFrame`** — preserved for Reset/Undo
7. ✅ **Metronome `headLength = 0`** — plays from buffer start, no skip
8. ✅ **AudioWorklet re-load guard** — `addModule` try/catch for second recording attempts
9. ✅ **`startupDelayMs` (150ms) + `bufferSafetyMs` (100ms)** — named constants for recording timing, editable in Dangerous Settings
10. ✅ **`syncedTrackIdsRef` removed** — App.tsx no longer gates `addTrack` behind a one-time-per-track check
12. ✅ **Pattern-based latency calibration** — new `calibration.worklet.js` for sample-accurate rising edge detection. Test signal: 500ms sustain (wakes Bluetooth) + 5 peaks at non-regular intervals [100,140,100,100,140]ms. Pattern matching eliminates false positives. Old `latency-detector.worklet.js` removed.

### Files Modified
- `public/worklets/calibration.worklet.js` — NEW: rising edge detector with configurable threshold/startFrame/minGapFrames
- `public/worklets/recorder.worklet.js` — single-buffer approach: no `_audioData`, rolling buffer stops trimming at `_recordingStartFrame`, `_flush()` extracts head + recording from one buffer
- `public/worklets/latency-detector.worklet.js` — DELETED (replaced by calibration.worklet.js)
- `src/lib/audio/LatencyCalibrator.ts` — rewritten: AudioWorklet-based edge detection + pattern matching; removed ScriptProcessorNode fallback
- `src/audio/recording/RecordingEngine.ts` — restored `punchInUserTime_Real` computation, named `startupDelay`/`bufferSafety`, `startPos = punchInUserTime - headLength`
- `src/lib/multitrack/webaudio.ts` — simplified `playAt()`, duplicate gain connection fix
- `src/lib/multitrack/multitrack.ts` — non-anchored tracks get `headLength: 0`
- `src/components/TakeBar.tsx` — Reset formula includes `secondsPerBar`
- `src/hooks/useAudioEngine.ts` — async IIFE, fire-and-forget resume, `sampleRate` in store
- `src/store/useStore.ts` — `sampleRate` state, `startupDelayMs`/`bufferSafetyMs` settings, `updatePhrasePosition` preserves anchor on move
- `src/App.tsx` — removed `syncedTrackIdsRef` guard, added Dangerous Settings UI

### Replaced Approaches
- ~~`audioOffset = -(headDuration + latencySec)`~~ → `anchoredFrame` + `headLength`
- ~~`WebAudioPlayer.offset` param~~ → `playedDuration` offset (plays all audio)
- ~~`startPosition = anchorFrame/sr − sPB − HL`~~ → `startPosition = punchInUserTime − headLength`
- ~~`captureImmediately` flag~~ → unconditional `_recordingStartFrame = _anchoredFrame` in worklet

### Git Commits
- `f4b742a` / `c57a68c` — old `audioOffset` approach (superseded by anchorFrame)
- `b32e74d` / `ddff309` — AudioWorklet timing fixes (foundation kept, details replaced)
- `a9a6976` / `9519804` — Store/UI fixes (mostly preserved)

### Testing Checklist
- [x] Recording creates clip with duration > 1 second (not 20ms)
- [x] `anchoredFrame` = absolute AudioContext clock frame (from `punchInUserTime_Real`)
- [x] `startPosition` = `punchInUserTime − headLength` (direct UserTime, no anchorFrame derivation)
- [x] `playAt()` plays entire buffer from position 0
- [x] Metronome plays correctly with `headLength = 0`
- [x] AudioWorklet re-load works on second recording
- [x] Pre-roll "always" → clip at Bar 1 (`punchInUserTime = 0`)
- [x] Live punch-in → clip at current playhead position
- [x] Latency compensation works (bluetooth, USB, etc.)
- [ ] `_flush()` extracts head + recording from single buffer (rolling buffer stops trimming at `_recordingStartFrame`)
- [ ] Pre-roll recording with 1-bar head (pending test)
- [x] `syncedTrackIdsRef` removed — all recordings update multitrack engine
- [x] `startupDelayMs` + `bufferSafetyMs` configurable in Dangerous Settings
- [ ] "none" mode while playing — clip at correct playhead position (pending test)
- [ ] `punchInUserTime` for `isCurrentlyPlaying` uses store `currentTime` (not `audioCtx.currentTime`)

---

## Postponed Changes

### 1. Rename Metronome Track ID from 'metronome' to '0'
**Why**: User asked "Is track ID for metronome '0'?" - currently it's 'metronome'.

**Impact**: Would require updating 15+ files that reference `'metronome'` track ID.

**Status**: Postponed until recording is fully functional.

---

### 2. Optimize `handleRecorderStop` Multiple Calls
**Current Behavior**: `handleRecorderStop` fires 2-3 times per recording (stale sessions are ignored).

**Possible Optimization**: Use `mediaRecorder.state` check or ref to prevent multiple calls.

**Status**: Low priority - works correctly with session ID check.

---

### 3. Add `~/` to Specs/Features That Were Replaced
**Current**: `docs/AUDIO_LOGIC_SPECS.md` has some outdated info.

**Needed**: Mark old sections with `~/` (strikethrough) when new understanding replaces them.

**Example**:
```
~/ Bar 0 is a count-in bar visible in the timeline.
Bar 0 is pre-roll ONLY, not visible in normal UI.
```

**Status**: Postponed.

---

### 4. Fix WaveSurfer Masking for Pre-roll Audio
**Location**: `src/lib/multitrack/multitrack.ts`, WaveSurfer region options

**Requirement**: 
- Clip `startPosition = punchInUserTime` (User Time, where user pressed Record)
- Audio buffer has 1s pre-roll BEFORE `punchInUserTime` (kept in buffer, NOT trimmed)
- **WaveSurfer Masking**: Hide the first 1s of waveform visually (but keep audio in buffer)
- **Purpose**: Allow future offset adjustment or fade-in using masked audio

**Implementation Research Needed**:
- Does WaveSurfer support "offset" parameter (region starts at X, audio starts earlier)?
- Can we use CSS `clip-path` or `overflow:hidden` for masking?
- Or do we need custom rendering with `minPxPerSec`?

**Status**: In Progress - see `.sisyphus/plans/simplified-recording-masking.md`

---

### 5. Undo Recording / New Take Enhancement
**Location**: UI + Store actions needed

**Requirements**:
- **Undo Recording**: Remove last recorded phrase from track (user wants to discard a bad take)
- **New Take**: Re-record over existing phrase (replace audio at same position)

**Implementation**:
1. Add UI buttons: "Undo Last Recording" and "New Take" (context menu on phrase?)
2. Add store actions: `removeLastPhrase(trackId)`, `replacePhrase(trackId, phraseId, newPhrase)`
3. For "New Take": Start recording at same `startPosition` as existing phrase, replace on stop

**Status**: Postponed - nice-to-have after core recording works.

---

### 6. Fix WaveSurfer Double-Destroy Bug
**Location**: `src/hooks/useAudioEngine.ts` (lines ~161-168, ~599-625)

**Problem**: Two `useEffect` cleanups both call `multitrack.destroy()` without guard.

**Fix**: Add a `_destroyed` flag to `Multitrack` class to skip duplicate destroy calls.

**Status**: Postponed - not blocking recording functionality.

---

### 7. Optimize Multitrack Re-initialization After Recording
**Location**: `src/hooks/useAudioEngine.ts` (main useEffect depends on `trackStructureHash`)

**Problem**: When a new phrase is added (post-recording), `trackStructureHash` changes, triggering full destruction/recreation of ALL WaveSurfer instances.

**Fix**: Use the existing `multitrack.addTrack()` method (in `multitrack.ts` lines 639-671) for single-phrase additions instead of full re-init.

**Note**: `addTrack()` is already implemented but not used in the current flow.

**Status**: Postponed - not blocking recording functionality.

---

### 6. Add `~/` to Specs/Features That Were Replaced
**Current**: `docs/AUDIO_LOGIC_SPECS.md` has some outdated info.

**Needed**: Mark old sections with `~/` (strikethrough) when new understanding replaces them.

**Example**:
```
~/ Bar 0 is a count-in bar visible in the timeline.
Bar 0 is pre-roll ONLY, not visible in normal UI.
```

**Status**: Postponed.

---

## Testing Checklist

After each fix, test:
- [x] Record button auto-selects track
- [x] Pre-roll (1-bar count-in) works
- [ ] Recording creates phrase at correct startPosition (negative for pre-roll)
- [ ] Stop button works (no hanging recordings)
- [ ] Multiple recordings on same track (multiple phrases)
- [ ] Cancel recording (no phrase created)
- [ ] Switch tracks mid-recording (edge case)

---

## Temporary Time Tweaks (May 2026)

### Problem Identified
Recording had **1 BAR** (~2.08s at 115 BPM) of pre-roll head instead of **1 SECOND**.

### Root Cause
- `startRecording()` sent `START_RECORDING` immediately (before pre-roll)
- AudioWorklet recorded from `currentFrame - sampleRate` (1s before message)
- If message received early in pre-roll → almost entire bar recorded

### Fix Implemented (Commit: TBD)
1. **Calculate `recordingStartTime_Real`** in `startRecording()`:
   ```typescript
   const punchInUserTime_Real = punchInUserTime + secondsPerBar;
   const recordingStartTime_Real = Math.max(0, punchInUserTime_Real - 1.0);
   ```
   Send to AudioWorklet via `postMessage()`.

2. **AudioWorklet uses `recordingStartTime`** from message:
   ```javascript
   if (event.data.recordingStartTime !== undefined) {
     this._recordingStartFrame = event.data.recordingStartTime * sampleRate;
   }
   ```

3. **Temporary UX fix**: `startPos = punchInUserTime - 1.0s`
   - **Why**: Audio has ~1s head, but without WaveSurfer masking, audio appears 1s late
   - **Where**: `handleAudioWorkletStop()` and `handleRecorderStop()`
   - **Future**: When masking is implemented, change back to `startPos = punchInUserTime`

### Comments Added to Code
- `RecordingEngine.ts`: Comments explaining temporary fix with `// TEMPORARY FIX:` prefix
- `recorder.worklet.js`: Comments explaining `recordingStartTime` usage

### WaveSurfer Masking (Future Implementation)
**Goal**: Hide first 1s of waveform visually while keeping audio in buffer.

**Benefits**:
1. Clip `startPosition = punchInUserTime` (correct timeline position)
2. Audio plays in sync (1s head is "behind" clip start)
3. Enable offset adjustment and fade-in features

**Status**: Postponed until core recording is verified stable.

---

## Git History (Relevant Commits)

```
9519804 Clean up useAudioEngine by removing unused refs and functions
c60aa4e Replace startRecording/stopRecording with RecordingEngine calls
21e002a Integrate MetronomeEngine and RecordingEngine into useAudioEngine
39f570a Add RecordingEngine and MetronomeEngine modules (not yet integrated)
29cd189 Fix: Resolve infinite recursion bug in LatencyCalibrator
2fb7e35 Refactor: AudioWorklet for Firefox compatibility + modular audio structure
```

---

## Original Code Reference

To understand the original working flow, check:
```bash
git show 2fb7e35^:src/hooks/useAudioEngine.ts
```

Key patterns from original:
- `audioContextRef.current` accessed directly at point of use (not stored)
- Throws error if AudioContext is null (doesn't create new one)
- `startRecording()` stops continuous recorder + immediately restarts
- `handleRecorderStop` uses `performance.now() - recorderStartTime` for timing
