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
1. `initStream()` creates MediaStream + starts `continuousRecorder` with `timeslice=100`
2. Audio chunks accumulate in `audioChunks[]` (circular buffer)
3. `startRecording()` stops recorder (recycles buffer from beginning) + restarts it
4. When user presses Stop, `handleRecorderStop` trims pre-roll from `audioChunks`

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

### 3. Fix WaveSurfer Double-Destroy Bug
**Location**: `src/hooks/useAudioEngine.ts` (lines ~161-168, ~599-625), `src/lib/multitrack/multitrack.ts`

**Problem**: Two `useEffect` cleanups both call `multitrack.destroy()` when `trackStructureHash` changes. The `Multitrack.destroy()` method has no guard against being called twice.

**Fix**: Add a `_destroyed` flag to `Multitrack` class:
```typescript
private _destroyed = false;

public destroy() {
  if (this._destroyed) return;
  this._destroyed = true;
  // ... rest of destroy logic
}
```

**Status**: Postponed - not blocking recording functionality.

---

### 4. Optimize Multitrack Re-initialization After Recording
**Location**: `src/hooks/useAudioEngine.ts` (main useEffect depends on `trackStructureHash`)

**Problem**: When a new phrase is added (post-recording), `trackStructureHash` changes, triggering full destruction/recreation of ALL WaveSurfer instances. This causes:
- Brief UI freeze (recreating many WaveSurfer instances)
- Playback interruption (if playing during punch-in)

**Fix**: Use the existing `multitrack.addTrack()` method (in `multitrack.ts` lines 639-671) for single-phrase additions instead of full re-init.

**Note**: `addTrack()` is already implemented but not used in the current flow.

**Status**: Postponed - not blocking recording functionality.

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
