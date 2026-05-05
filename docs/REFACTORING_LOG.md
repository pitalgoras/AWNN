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
