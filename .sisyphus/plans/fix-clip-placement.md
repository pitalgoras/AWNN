# Fix: Clip Placement & AudioWorklet Recording

## TL;DR
> **Quick Summary**: Fix broken AudioWorklet rolling buffer (negative startFrame bug) and correct clip startPos to use punchInUserTime.
> 
> **Deliverables**: 
> - Working AudioWorklet recording (no rolling buffer)
> - Clips appear at correct position (where Record was pressed)
> - Multiple recordings at different positions
> 
> **Estimated Effort**: Short
> **Parallel Execution**: NO - sequential (AudioWorklet → RecordingEngine)
> **Critical Path**: Task 1 → Task 2

---

## Context

### Original Request
User reported: "no clips appear after recording!" after recent changes.

### Interview Summary
**Key Findings from Log Analysis** (`console-export-2026-5-5_22-54-4.log`):
1. `startFrame: -92035` sent to AudioWorklet → **NEGATIVE frame number**
2. AudioWorklet `Recording started at -2.08696` → Negative start time
3. `duration: 0.020` → Only **20ms** of audio recorded (essentially empty)
4. `startPos: -0.204` → Negative start position (before timeline)

**Root Cause**: 
- `startFrame` calculation: `audioContext.currentTime` was ~0.02s when recording started
- Formula: `(0.02 - 2.0) * 44100 = -87358` ≈ -92035 (negative!)
- Rolling buffer can't retrieve audio from negative frames
- Result: AudioWorklet captures almost no audio (only 20ms between START/STOP processing)

### What Worked Before
Before rolling buffer changes (commit `1351376`), clips WERE appearing (at position 0, which was wrong position but they were visible). The old code:
- Used simple AudioWorklet recording (no rolling buffer)
- Sent `AUDIO_DATA` messages with Float32Array chunks
- `startPos = recordingStartTransportTime - latencySec`
- No trimming of audio data

---

## Work Objectives

### Core Objective
Fix AudioWorklet recording to create visible clips at the correct timeline position.

### Concrete Deliverables
- `public/worklets/recorder.worklet.js` - Simple recording (no rolling buffer)
- `src/audio/recording/RecordingEngine.ts` - Fix `startPos` to use `punchInUserTime`
- Clips appear at playhead position when Record was pressed

### Definition of Done
- [ ] Recording creates clip with duration > 1 second
- [ ] Clip appears at correct position (where Record was pressed)
- [ ] Multiple recordings appear at different positions
- [ ] No negative `startFrame` sent to AudioWorklet

### Must Have
- Simple AudioWorklet recording (no rolling buffer)
- `startPos = punchInUserTime - latencySec`
- No negative frame calculations

### Must NOT Have (Guardrails)
- No rolling buffer (broken, caused the bug)
- No `startFrame` sent to AudioWorklet
- No trimming of audio data in `handleAudioWorkletStop()`

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (React app with AudioWorklet)
- **Automated tests**: NO (manual testing with app)
- **Framework**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Sequential - AudioWorklet changes affect RecordingEngine):
├── Task 1: Fix AudioWorklet (remove rolling buffer)
└── Task 2: Fix RecordingEngine (startPos + handleAudioWorkletStop)

Wave FINAL (After ALL tasks):
├── Task F1: Verify recording creates clip with correct position
└── Task F2: Verify multiple recordings at different positions
```

### Dependency Matrix
- **1**: - - Task 2
- **2**: Task 1 - -

---

## TODOs

- [ ] 1. Fix AudioWorklet - Remove Rolling Buffer

  **What to do**:
  - Revert to simple AudioWorklet recording (like commit `1351376`)
  - Remove all rolling buffer logic (`_rollingBuffer`, `_rollingBufferDuration`, `_startFrame`)
  - `START_RECORDING`: Start recording from `currentFrame`, send `RECORDING_STARTED`
  - `STOP_RECORDING`: Call `_flush()`, send `RECORDING_STOPPED` with combined audio data
  - `_flush()`: Combine `this._audioData` chunks into one Float32Array, send via `AUDIO_DATA` message
  - Remove message passing for `startFrame` (no longer needed)

  **Must NOT do**:
  - Keep rolling buffer (broken)
  - Send `startFrame` to AudioWorklet
  - Filter audio data based on frame numbers

  **Recommended Agent Profile**:
  > **Category**: `quick` - Simple file edit, revert to known working pattern.
  > - **Reason**: Task is reverting code to a simpler pattern, minimal logic changes.
  > - **Skills**: None needed (direct file edit).
  > - **Skills Evaluated but Omitted**: `git` (not needed, working in Plan Mode).

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (must run before Task 2)
  - **Blocks**: Task 2 (depends on AudioWorklet structure)
  - **Blocked By**: None

  **References**:
  - `public/worklets/recorder.worklet.js` - Current broken version with rolling buffer
  - Commit `1351376:public/worklets/recorder.worklet.js` - Working version to revert to

  **Acceptance Criteria**:
  - [ ] AudioWorklet has no `_rollingBuffer` or `_startFrame` variables
  - [ ] `START_RECORDING` message starts recording from `currentFrame`
  - [ ] `STOP_RECORDING` message calls `_flush()` and sends `RECORDING_STOPPED`
  - [ ] `_flush()` sends `AUDIO_DATA` message with combined Float32Array
  - [ ] No negative frame calculations

  **QA Scenarios**:
  ```
  Scenario: AudioWorklet starts recording without negative frames
    Tool: Bash (grep for negative frame handling)
    Preconditions: AudioWorklet file exists
    Steps:
      1. grep for "_rollingBuffer\|_startFrame\|startFrame" in recorder.worklet.js
      2. Assert: No matches found (rolling buffer removed)
    Expected Result: File contains simple recording logic only
    Evidence: .sisyphus/evidence/task-1-no-rolling-buffer.txt
  ```

  **Commit**: YES
  - Message: `fix: Remove broken rolling buffer from AudioWorklet`
  - Files: `public/worklets/recorder.worklet.js`
  - Pre-commit: `npm run build` (verify no errors)

---

- [ ] 2. Fix RecordingEngine - Correct startPos + Remove Trimming

  **What to do**:
  - Add `private punchInUserTime = 0;` to class properties (if not present)
  - In `startRecording()`: Set `this.punchInUserTime = Math.max(0, this.config.currentTime);`
  - In `startRecording()`: Remove `startFrame` calculation and sending to AudioWorklet
  - In `handleAudioWorkletStop()`: Fix `startPos = this.punchInUserTime - latencySec;`
  - In `handleAudioWorkletStop()`: Remove trimming logic (use audioData as-is)
  - In `handleAudioWorkletStop()`: Read from `this.audioWorkletData` (populated by `AUDIO_DATA` messages)

  **Must NOT do**:
  - Trim audio data based on `punchInUserTime - recordingStartTransportTime`
  - Send `startFrame` to AudioWorklet
  - Use `recordingStartTransportTime` for `startPos`

  **Recommended Agent Profile**:
  > **Category**: `quick` - Targeted edits to fix startPos calculation.
  > - **Reason**: Straightforward variable fixes and removing broken logic.
  > - **Skills**: None needed.
  > - **Skills Evaluated but Omitted**: `git` (not needed).

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (depends on Task 1 AudioWorklet structure)
  - **Blocks**: Final verification
  - **Blocked By**: Task 1

  **References**:
  - `src/audio/recording/RecordingEngine.ts` - Current broken version
  - Commit `1351376:src/audio/recording/RecordingEngine.ts` - Working `handleAudioWorkletStop()` pattern
  - Lines ~360-450: `handleAudioWorkletStop()` to fix
  - Lines ~449-550: `startRecording()` to fix

  **Acceptance Criteria**:
  - [ ] `startPos = this.punchInUserTime - latencySec` (not `recordingStartTransportTime`)
  - [ ] No trimming logic in `handleAudioWorkletStop()`
  - [ ] `startRecording()` does NOT send `startFrame` to AudioWorklet
  - [ ] `punchInUserTime` is set in `startRecording()`
  - [ ] `handleAudioWorkletStop()` reads from `this.audioWorkletData` (not function params)

  **QA Scenarios**:
  ```
  Scenario: startPos uses punchInUserTime (not recordingStartTransportTime)
    Tool: Bash (grep for startPos calculation)
    Preconditions: RecordingEngine.ts exists
    Steps:
      1. grep for "startPos = " in RecordingEngine.ts
      2. Assert: Line contains "punchInUserTime" (not "recordingStartTransportTime")
    Expected Result: startPos correctly uses punchInUserTime
    Evidence: .sisyphus/evidence/task-2-startpos-fix.txt

  Scenario: No trimming logic in handleAudioWorkletStop
    Tool: Bash (grep for trim logic)
    Preconditions: RecordingEngine.ts exists
    Steps:
      1. grep for "trimSec\|trimSamples\|slice" in RecordingEngine.ts handleAudioWorkletStop
      2. Assert: No trimming logic found
    Expected Result: Audio data used as-is (no trimming)
    Evidence: .sisyphus/evidence/task-2-no-trim.txt
  ```

  **Commit**: YES
  - Message: `fix: Correct clip startPos to use punchInUserTime, remove trimming`
  - Files: `src/audio/recording/RecordingEngine.ts`
  - Pre-commit: `npm run build` (verify no errors)

---

## Final Verification Wave

- [ ] F1. **Verify Recording Creates Clip** — `quick`
  - Build project: `npm run build`
  - Start dev server: `npm run dev`
  - Instructions for agent: 
    1. Open browser to localhost:5173
    2. Press Record on a track (pre-roll "always")
    3. Wait 3-5 seconds, press Stop
    4. Verify clip appears in timeline at Bar 1 (position ~0)
    5. Click clip, verify audio plays back
  - Output: `Clip created: {startPosition, duration} | VERDICT: PASS/FAIL`

- [ ] F2. **Verify Multiple Recordings at Different Positions** — `quick`
  - Continue from F1 (don't refresh)
  - Instructions for agent:
    1. Start playback, wait until playhead reaches Bar 2 (position 2)
    2. Press Record on a different track
    3. Wait 2-3 seconds, press Stop
    4. Verify SECOND clip appears at Bar 2 (position ~2)
    5. Verify FIRST clip still at Bar 1
  - Output: `Multiple clips at different positions | VERDICT: PASS/FAIL`

---

## Commit Strategy

- **1**: `fix: Remove broken rolling buffer from AudioWorklet` - `public/worklets/recorder.worklet.js`, `npm run build`
- **2**: `fix: Correct clip startPos to use punchInUserTime` - `src/audio/recording/RecordingEngine.ts`, `npm run build`

---

## Success Criteria

### Verification Commands
```bash
npm run build  # Expected: SUCCESS (no errors)
grep -n "startPos = " src/audio/recording/RecordingEngine.ts  # Expected: contains "punchInUserTime"
grep -n "_rollingBuffer\|_startFrame" public/worklets/recorder.worklet.js  # Expected: NO matches
```

### Final Checklist
- [ ] AudioWorklet has no rolling buffer (Task 1)
- [ ] `startPos` uses `punchInUserTime` (Task 2)
- [ ] No negative `startFrame` sent to AudioWorklet
- [ ] Recording creates clip with duration > 1 second
- [ ] Clip appears at correct position (where Record was pressed)
- [ ] Multiple recordings at different positions work
