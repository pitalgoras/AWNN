# Fix: AudioWorklet Recording with Rolling Buffer

## TL;DR
> **Quick Summary**: Fix rolling buffer startup delay fix (negative startFrame bug) and correct clip startPos to use punchInUserTime.
> 
> **Deliverables**: 
> - Working rolling buffer (2 seconds) to fight recording startup delay (not jitter)
> - Clips appear at correct position (where Record was pressed)
> - Audio data has proper duration (> 1 second, not 20ms)
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: NO - sequential (AudioWorklet → RecordingEngine)
> **Critical Path**: Task 1 → Task 2 → Task 3.

---

## Context

### Original Request
User wants unified rolling buffer solution to fight timing evils (especially #3 - jitter). The rolling buffer should:
- Run during playback (2 seconds)
- Allow punch-in at any time (buffer has audio from before)
- Handle pre-roll cases (count-in)
- Handle "none" + not playing (prime buffer, delay 1s)

### Bug Analysis (from logs)
**Console log `console-export-2026-5-5_22-54-4.log`**:
1. Line 103: `startFrame: -92035` → **NEGATIVE frame number** (the bug!)
2. Line 136: `duration: 0.020` → Only **20ms** of audio (essentially empty)
3. Line 136: `startPos: -0.204` → Negative start position

**Root Cause**: 
- `startFrame = (audioContext.currentTime - secondsPerBar) * sampleRate`
- When `audioContext.currentTime ≈ 0.02s`, this gives `(0.02 - 2.0) * 44100 = -87358` (negative!)
- AudioWorklet can't retrieve audio from negative frames
- Rolling buffer returns almost no audio

### Timing Evils We're Fighting (ALL 4)
1. **Input Latency** → `globalLatencyMs` (handled)
2. **Output Latency** → `outputLatency` (handled)
3. **Recording/Playback Jitter** → AudioWorklet shared clock (already addressed)
4. **UI Delays/Startup Delay** → **Rolling buffer** (this is what we're fixing!)

**Rolling Buffer Purpose**: Fight **startup delay** (Evil #4) - by capturing continuously during playback, when user presses Record, the buffer already has audio from before the button press → no startup latency.

### User Time vs Real Time (CRITICAL DISTINCTION)
| Concept | User Time (Timeline) | Real Time (AudioContext) |
|---------|----------------------|--------------------------|
| **Definition** | Timeline position (Bar 1 = 0) | `audioContext.currentTime` (since creation) |
| **Example** | `punchInUserTime = 0` (Bar 1) | `audioContext.currentTime = 6.93s` |
| **Bar 0** | Negative (e.g., -2s) | N/A |
| **Used For** | `startPos`, timeline display | AudioWorklet frames, WebAudio API |
| **Variable** | `punchInUserTime` | `currentFrame`, `startFrame` |

**Key Rules**:
- `punchInUserTime` is **User Time** → used for `startPos` (where clip appears on timeline)
- `startFrame` sent to AudioWorklet is **Real Time** (frame number = `currentFrame` or calculated from `audioContext.currentTime`)
- Rolling buffer stores **Real Time** frames (`currentFrame`)
- When retrieving from buffer: `startFrame` must be a valid **Real Time** frame (≥ 0 and ≤ `currentFrame`)

### What Worked Before
Before rolling buffer changes (commit `1351376`), clips WERE appearing (at position 0, wrong position but visible). The old code:
- Used simple AudioWorklet (no rolling buffer)
- `startPos = recordingStartTransportTime - latencySec`
- No trimming, audio data used as-is

### User's Requirement
Keep the unified rolling buffer solution (for timing evils), but FIX the implementation bugs.

---

## Work Objectives

### Core Objective
Fix AudioWorklet rolling buffer to correctly record audio and place clips at the right position.

### Concrete Deliverables
- `public/worklets/recorder.worklet.js` - Fixed rolling buffer (no negative frame bug)
- `src/audio/recording/RecordingEngine.ts` - Correct `startPos` using `punchInUserTime`
- Clips appear at playhead position when Record was pressed

### Definition of Done
- [ ] Recording creates clip with duration > 1 second (not 20ms)
- [ ] Clip appears at correct position (where Record was pressed)
- [ ] No negative `startFrame` sent to AudioWorklet
- [ ] Rolling buffer works for pre-roll cases

### Must Have
- Rolling buffer (2 seconds) for timing evil #4 (startup delay), NOT #3 (jitter - already handled by AudioWorklet shared clock)
- `startPos = punchInUserTime - latencySec` (User Time for timeline position)
- Fix negative `startFrame` calculation in `startRecording()` (Real Time frame check)

### Must NOT Have (Guardrails)
- No negative `startFrame` sent to AudioWorklet
- No empty audio data (20ms clips)
- No trimming that removes all audio
- Don't revert to simple AudioWorklet (keep rolling buffer)

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
Wave 1 (Sequential - each task depends on previous):
├── Task 1: Fix AudioWorklet rolling buffer (fix negative frame bug)
├── Task 2: Fix RecordingEngine startPos + handleAudioWorkletStop
└── Task 3: Fix startRecording() to not send negative startFrame

Wave FINAL (After ALL tasks):
├── Task F1: Verify recording creates clip with correct position
└── Task F2: Verify rolling buffer works for pre-roll
```

### Dependency Matrix
- **1**: - - Task 2, Task 3
- **2**: Task 1 - Task 3
- **3**: Task 1, Task 2 - F1, F2
- **F1**: Task 3 - -
- **F2**: Task 3 - -

---

## TODOs

- [ ] 1. Fix AudioWorklet - Rolling Buffer (Real Time Frames)

  **What to do**:
  - `startFrame` sent to AudioWorklet is **Real Time** (frame number = `currentFrame` or calculated from `audioContext.currentTime`)
  - In `process()` method, when handling `START_RECORDING` with `startFrame`:
    - Check if `startFrame >= 0` and `startFrame <= currentFrame` (valid Real Time frame)
    - If invalid: set `this._recordingStartFrame = currentFrame` (start from now, Real Time)
    - If valid: use `this._startFrame` to retrieve from rolling buffer
  - In `_flush()`: 
    - Filter rolling buffer entries where `entry.frame >= this._recordingStartFrame` (Real Time frames)
    - Combine into one Float32Array
    - Send via `AUDIO_DATA` message (not `RECORDING_STOPPED` directly)
  - Remove negative frame check in `startRecording()` (do it in AudioWorklet instead)

  **Must NOT do**:
  - Remove rolling buffer (keep it for timing evils)
  - Send negative frames to AudioWorklet

  **Recommended Agent Profile**:
  > **Category**: `quick` - Fix conditional logic in AudioWorklet.
  > - **Reason**: Straightforward bounds checking, no complex logic.
  > - **Skills**: None needed.
  > - **Skills Evaluated but Omitted**: `git` (not needed).

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (must run before Task 2)
  - **Blocks**: Task 2, Task 3
  - **Blocked By**: None

  **References**:
  - `public/worklets/recorder.worklet.js` - Lines 70-92: START_RECORDING handler
  - `public/worklets/recorder.worklet.js` - Lines 136-152: `_flush()` method

  **Acceptance Criteria**:
  - [ ] AudioWorklet handles negative `startFrame` gracefully (uses `currentFrame`)
  - [ ] `_flush()` filters rolling buffer from `recordingStartFrame` to `currentFrame`
  - [ ] No negative frame errors in console

  **QA Scenarios**:
  ```
  Scenario: AudioWorklet handles negative startFrame
    Tool: Bash (grep for frame validation)
    Preconditions: AudioWorklet file exists
    Steps:
      1. Check AudioWorklet code for `startFrame >= 0` or similar validation
      2. Assert: Code handles negative frames gracefully
    Expected Result: AudioWorklet doesn't crash on negative startFrame
    Evidence: .sisyphus/evidence/task-1-frame-check.txt
  ```

  **Commit**: YES
  - Message: `fix: AudioWorklet handles negative startFrame gracefully`
  - Files: `public/worklets/recorder.worklet.js`
  - Pre-commit: `npm run build`

---

- [ ] 2. Fix RecordingEngine - startPos + handleAudioWorkletStop

  **What to do**:
  - In `handleAudioWorkletStop()`:
    - Use `this.punchInUserTime` for `startPos` calculation
    - `const startPos = this.punchInUserTime - latencySec;`
    - Remove trimming logic (use audioData as-is from AudioWorklet)
  - Ensure `punchInUserTime` is set in `startRecording()`:
    - `this.punchInUserTime = Math.max(0, this.config.currentTime);`

  **Must NOT do**:
  - Trim audio data based on `punchInUserTime - recordingStartTransportTime`
  - Use `recordingStartTransportTime` for `startPos`

  **Recommended Agent Profile**:
  > **Category**: `quick` - Targeted edits to fix startPos calculation.
  > - **Reason**: Simple variable assignment fixes.
  > - **Skills**: None needed.
  > - **Skills Evaluated but Omitted**: `git` (not needed).

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (depends on Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `src/audio/recording/RecordingEngine.ts` - Lines 359-450: `handleAudioWorkletStop()`
  - `src/audio/recording/RecordingEngine.ts` - Lines 449-550: `startRecording()`

  **Acceptance Criteria**:
  - [ ] `startPos = this.punchInUserTime - latencySec` (not `recordingStartTransportTime`)
  - [ ] No trimming logic in `handleAudioWorkletStop()`
  - [ ] `punchInUserTime` is set in `startRecording()`

  **QA Scenarios**:
  ```
  Scenario: startPos uses punchInUserTime
    Tool: Bash (grep for startPos calculation)
    Preconditions: RecordingEngine.ts exists
    Steps:
      1. grep for "startPos =" in RecordingEngine.ts
      2. Assert: Line contains "punchInUserTime" (not "recordingStartTransportTime")
    Expected Result: startPos correctly uses punchInUserTime
    Evidence: .sisyphus/evidence/task-2-startpos.txt
  ```

  **Commit**: YES
  - Message: `fix: Use punchInUserTime for clip startPos`
  - Files: `src/audio/recording/RecordingEngine.ts`
  - Pre-commit: `npm run build`

---

- [ ] 3. Fix startRecording() - Don't Send Negative startFrame (Real Time Check)

  **What to do**:
  - **CRITICAL**: `startFrame` is **Real Time** (frame number), NOT User Time!
  - In `startRecording()`, when sending `startFrame` to AudioWorklet:
    - **Check (Real Time)**: `if (audioContext.currentTime >= secondsPerBar)`
    - If NOT enough Real Time elapsed: **don't send `startFrame`** (AudioWorklet starts from `currentFrame`)
    - If enough time: calculate `startFrame = (audioContext.currentTime - secondsPerBar) * sampleRate` (both are Real Time)
    - **Remove**: Any calculation that mixes User Time (`punchInUserTime`) with Real Time (`currentFrame`)
  - For "none" + not playing: keep the 1s delay to prime buffer (Real Time)

  **Must NOT do**:
  - Send negative `startFrame` to AudioWorklet
  - Calculate `startFrame` without checking `audioContext.currentTime`

  **Recommended Agent Profile**:
  > **Category**: `quick` - Fix frame calculation logic.
  > - **Reason**: Simple conditional check before sending message.
  > - **Skills**: None needed.
  > - **Skills Evaluated but Omitted**: `git` (not needed).

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (depends on Task 1 and 2)
  - **Blocks**: Final verification
  - **Blocked By**: Task 1, Task 2

  **References**:
  - `src/audio/recording/RecordingEngine.ts` - Lines 478-500: startFrame calculation

  **Acceptance Criteria**:
  - [ ] `startFrame` is NEVER negative
  - [ ] Code checks `audioContext.currentTime >= secondsPerBar` before calculating `startFrame`
  - [ ] If not enough time, doesn't send `startFrame` (AudioWorklet starts from now)

  **QA Scenarios**:
  ```
  Scenario: No negative startFrame sent
    Tool: Bash (manual testing)
    Preconditions: Dev server running
    Steps:
      1. Open browser to localhost:5173
      2. Press Record (pre-roll "always")
      3. Check console for "startFrame:" message
      4. Assert: startFrame is NOT negative
    Expected Result: startFrame is either positive or not sent
    Evidence: .sisyphus/evidence/task-3-no-negative-frame.txt
  ```

  **Commit**: YES
  - Message: `fix: Don't send negative startFrame to AudioWorklet`
  - Files: `src/audio/recording/RecordingEngine.ts`
  - Pre-commit: `npm run build`

---

## Final Verification Wave

- [ ] F1. **Verify Recording Creates Clip with Correct Position** — `quick`
  - Build project: `npm run build`
  - Start dev server: `npm run dev`
  - Instructions for agent: 
    1. Open browser to localhost:5173
    2. Press Record on a track (pre-roll "always")
    3. Wait 3-5 seconds, press Stop
    4. Verify clip appears in timeline at Bar 1 (position ~0)
    5. Click clip, verify audio plays back (duration > 1 second)
    6. Check console: `startFrame` should NOT be negative
  - Output: `Clip created: {startPosition, duration} | VERDICT: PASS/FAIL`

- [ ] F2. **Verify Rolling Buffer Works for Pre-roll** — `quick`
  - Continue from F1 (don't refresh)
  - Instructions for agent:
    1. Start playback, wait until playhead reaches Bar 2
    2. Press Record (live punch-in)
    3. Wait 2-3 seconds, press Stop
    4. Verify SECOND clip appears at Bar 2 (position ~2)
    5. Verify both clips have correct audio
  - Output: `Multiple clips at different positions | VERDICT: PASS/FAIL`

---

## Commit Strategy

- **1**: `fix: AudioWorklet handles negative startFrame gracefully` - `public/worklets/recorder.worklet.js`
- **2**: `fix: Use punchInUserTime for clip startPos` - `src/audio/recording/RecordingEngine.ts`
- **3**: `fix: Don't send negative startFrame to AudioWorklet` - `src/audio/recording/RecordingEngine.ts`

---

## Success Criteria

### Verification Commands
```bash
npm run build  # Expected: SUCCESS (no errors)
grep -n "startFrame" public/worklets/recorder.worklet.js  # Expected: Has validation for negative frames
grep -n "startPos =" src/audio/recording/RecordingEngine.ts  # Expected: contains "punchInUserTime"
```

### Final Checklist
- [ ] Rolling buffer kept (not removed)
- [ ] No negative `startFrame` sent to AudioWorklet
- [ ] `startPos` uses `punchInUserTime`
- [ ] Recording creates clip with duration > 1 second
- [ ] Clip appears at correct position (where Record was pressed)
- [ ] Multiple recordings at different positions work
