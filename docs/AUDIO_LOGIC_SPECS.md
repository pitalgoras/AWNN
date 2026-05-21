# Audio Engine & Interaction Specifications (Updated for anchorFrame)

This document outlines the comprehensive logic, edge cases, and user experience decisions for the multitrack audio engine.

## 1. Global Locks & Interaction Modes
To prevent accidental destructive edits during playback and mixing, the application utilizes global lock toggles in the main toolbar:
*   **Clip Movement Lock (Padlock):** Disabled by default. When locked, clicking and dragging on the tracks scrolls the view. When unlocked, users can click and drag clips to reposition them on the timeline.
*   **Envelope Lock:** Disabled by default. Prevents accidental modification of volume automation nodes. When unlocked, the track expands to provide a larger canvas for automation editing.

## 2. Envelope Automation Logic
*   **Interpolation:** Volume is calculated using linear interpolation between nodes.
*   **Hold Values:** Before the first node and after the last node, the volume level is held constant at the value of that node. This is visually represented by dashed lines in the editor.
*   **Relative Volume:** Envelope values (0.0 to 1.0) act as a multiplier for the track's base volume slider.
*   **Clip Sync:** When a clip is moved on the timeline, any envelope nodes located within that clip's time range are automatically shifted by the same amount to maintain synchronization between audio and automation.
*   **Drag-to-Delete:** Nodes can be deleted by dragging them vertically far outside (60px+) the track boundaries.

## 3. Recording, Pre-roll & Tempo Logic
*   **Pre-roll (Count-in) Behavior (UPDATED):**
*   **Rolling Buffer:** Always captures ~2s of audio during playback (in AudioWorklet). Single-buffer approach: before `_recordingStartFrame`, buffer is trimmed normally; at/after `_recordingStartFrame`, trimming stops, preserving the entire clip in one contiguous buffer.
*   **Head:** Audio already in rolling buffer when Recording starts (last `headLength` seconds before `_recordingStartFrame`) — extracted by `_flush()` directly from the buffer. No separate `_audioData` stream.
*   **Pre-roll Mode:** Affects PLAYBACK timing (when to start), NOT recording capture
*   **Recording Logic (UPDATED):**
    *   **`anchoredFrame`** = `floor(punchInUserTime_Real × sampleRate)` — AudioContext clock frame of definitive audio start (ground truth for sync). `punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn`.
    *   **`startPosition`** = `punchInUserTime - headLength` — visual clip includes head before anchor. Computed directly from UserTime to avoid drift from AudioContext clock delays.
    *   **Rolling buffer** always captures during playback → Head is always present (~`headLength` seconds)
    *   **WaveSurfer plays entire buffer** from position 0 → head audio is audible, followed by definitive recording
    *   **`headLength`** is per-clip metadata (editable in SyncTool) — changing it adjusts visual boundaries without affecting sync
    *   **`startupDelayMs`** (default 150ms) and **`bufferSafetyMs`** (default 100ms) are editable in Dangerous Settings within the Advanced Settings modal. `startupDelayMs` estimates the time between `onSetIsPlaying(true)` and actual AudioContext playback start. `bufferSafetyMs` adds extra wait margin to ensure the rolling buffer is populated before START_RECORDING is sent.
*   **Tempo Control (BpmInput):**
    *   **Interaction:** Supports direct typing (3-digit), vertical scrubbing (drag-to-change), and arrow keys (Up/Down).
    *   **Responsiveness:** The UI prioritizes input responsiveness. Metronome regeneration is debounced (500ms) to prevent audio processing from interrupting the user's input flow.
    *   **State Sync:** Uses a `key={bpm}` prop on the `BpmInput` component to force re-initialization from global state, preventing infinite render loops while ensuring the local input is always accurate.
*   **Metronome Settings:**
    *   **Specialized Modal:** A dedicated modal for BPM, Time Signature, and Metronome Volume.
    *   **Track Isolation:** The metronome track does not trigger the standard "Track Settings" modal, maintaining its specialized nature.
*   **Timeline Grid Performance:**
    *   **Virtualization:** The grid only renders beat/bar lines that are currently visible in the viewport, maintaining 60fps performance even at high zoom levels.
*   **Audio Integrity:** Audio clips are stored at their absolute time in seconds/milliseconds. Changing the BPM shifts the grid and metronome but does NOT stretch or move existing audio clips.
*   **Metronome:** A dedicated metronome track provides a click track. The metronome is a live `AudioWorkletProcessor` (`metronome.worklet.js`, registered as `'metronome-processor'`) that generates click sounds in real time using the shared `AudioContext` clock. Clicks are scheduled via the global `currentFrame` (AudioWorklet frame counter). The metronome uses the project's BPM and time signature to determine beat positions. It can be muted or its volume adjusted. The metronome plays from the start of playback with no head offset (`headLength = 0`). **Timing:** On playback start, the main thread computes the next grid-aligned beat after `currentTime + startupDelayMs`, then calls `startAt()` on `MetronomeEngine` which sends a `START_AT` message to the worklet. The worklet receives `{ nextBeatFrame, beatIndex, beatsPerBar, barTempo[], barStartFrame }`. `barTempo` is an array of `{ bpm, framesPerBeat }` indexed by bar number — single entry today, extensible for per-bar tempo maps. `barStartFrame` is the AudioContext frame of project bar 0, used for bar-indexed tempo lookups. At each beat boundary in `process()`, the worklet checks `floor(beatIndex / beatsPerBar)` against `barTempo[]` and applies the correct tempo. The metronome track is thinner (40px) and has no text label on its clips. **Track ID:** `'metronome'`.
*   **Continuous Recorder Pattern:** The AudioWorklet runs continuously during playback, maintaining a 2-second rolling buffer in the audio render thread. This eliminates microphone cold-start latency and provides a pre-roll head before recording punches in. No `MediaRecorder` is used — all capture happens on the shared AudioContext clock for jitter-free sync.
*   **Cues & Navigation:**
    *   **Cues:** Users can add markers (cues) to the timeline. Cues are visible in the transport bar and the sidebar.
    *   **Bar.Beat Display:** The transport bar features a digital display showing the current position in `Bar.Beat` format (e.g., `1.1`, `2.3`). User Time 0.0 corresponds to Bar 1.1.

## 4. Latency Compensation & Sync (anchorFrame Approach)

*   **Visual Sync ($L_{vis}$):** The visual playhead position is calculated as `currentTime - outputLatency`. This ensures the cursor visually matches the sound hitting the user's ears.
*   **Recording Sync ($L_{rt}$):** Recorded clips use `anchoredFrame` (shared-clock frame number) as the ground truth for sync. This frame number represents the exact moment in the AudioContext clock where the definitive recording begins.
    *   **Hardware compensation (`HW_COMP_MS` = 930ms):** Firefox + Linux + Bluetooth adds ~930ms of unaccounted playback delay beyond `outputLatency + baseLatency`. Root cause unknown (suspected PipeWire/A2DP buffering). This constant is hardcoded in `RecordingEngine.handleAudioWorkletStop()` and applied on top of browser-reported latency. Revisit if the audio pipeline changes or if a proper fix is found.
    *   **`anchoredFrame`** = `floor(punchInUserTime_Real × sampleRate)` — absolute frame from AudioContext clock. `punchInUserTime_Real = audioContext.currentTime + startupDelay + timeFromPlaybackStartToPunchIn`.
    *   **`headLength`** (per clip, default 1.0s) — rolling buffer audio prepended before anchor. Single-buffer approach: `_flush()` extracts head from the last `headLength` seconds of buffer before `_recordingStartFrame`; no separate `_audioData` stream.
    *   **`originalAnchoredFrame`** — snapshot at creation for Reset/Undo
*   **Track Offset:** Each track supports a manual `offset` (in seconds) to nudge its timing. Applied during `startPosition` calculation in `useAudioEngine.ts`.
*   **Sample-Accurate Playback:** The engine uses `AudioBufferSourceNode` for all playback, ensuring sample-accurate timing that is independent of JavaScript main-thread jitter.
*   **Sync Implementation:**
    *   **Playback offset formula:** `offset = playedDuration` (plays entire buffer from start, including head)
    *   **Visual startPosition:** `punchInUserTime - headLength` (direct UserTime, not derived from anchoredFrame)
    *   **Move/Nudge:** `anchoredFrame = originalAnchoredFrame + round(delta × sampleRate)`
    *   **Reset:** `startPosition = (originalAnchoredFrame / sampleRate) - secondsPerBar - headLength`

## 5. Selection & Interaction
*   **Intelligent Phrase Selection:** Double-clicking on a track identifies the phrase (clip) currently under the playhead (`currentTime`) and selects it. This allows for quick access to clip-specific settings like manual offsets or deletion.
*   **Track Expansion:** Selecting a track while the Envelope Lock is disabled expands the track height (from 50px to 80px) to facilitate precise automation editing. Waveforms are automatically re-centered vertically within the new height.

## 3. Dragging, Trimming & Extending
*   **Trimming/Extending Edges:** Users can drag the left or right edges of a clip to trim silence or extend the clip.
*   **Strict Bounds:** Extending a clip is strictly bound by the original audio recording length. Users cannot extend a clip past its original recorded duration (no looping or empty space generation).
*   **Collisions:** If extending a clip causes it to collide with an adjacent clip, it triggers the Overlap Solver menu.

## 4. Overlap Resolution & The Solver Menu
When a clip is dragged and dropped (or extended) so that it partially overlaps another clip, the **Overlap Solver** floating menu appears.

### Complete / Multiple Overlaps (Destructive)
*   If a clip is dropped such that it completely swallows another smaller clip, or overlaps multiple clips simultaneously, the underlying clips are destructively overwritten (deleted/trimmed) to maintain predictable, tape-style logic.

### Partial Overlaps (The Floating Menu)
For simple edge overlaps, a dismissible floating menu appears offering the following choices:
*   **Left over Right (Icon):** Applies a 0.5s fade-out to the Left clip and a 0.5s fade-in to the Right clip at the transition point.
*   **Left under Right (Icon):** Applies a 0.5s fade-out to the Right clip and a 0.5s fade-in to the Left clip.
*   **Undo:** Reverts the drag/drop or punch-in action completely.
*   **Record same take again:** Deletes the newly recorded/dropped clip, moves the playhead back to the original start time of that clip, and immediately arms/starts recording again.

### Menu Mechanics
*   **Envelopes:** The crossfades are achieved using volume envelopes (automation curves). The clips remain visually overlapping so the user can see the underlying audio.
*   **Dismissal & Default:** The menu is dismissible by clicking anywhere outside of it. 
    *   If the user has already clicked a choice (e.g., "Left over Right"), clicking away simply closes the menu and leaves that choice applied.
    *   If the user clicks away *without* ever making a choice, the **default overlap choice** is automatically applied: **The new clip fades IN over the old clip at its start, and fades OUT under the old clip at its end.** (Essentially, the new clip sits "on top" in the middle, but tucks under at the edges).
*   **Double Overlaps (Bridging):** If a clip is dropped such that it partially overlaps *two* different clips (e.g., bridging a gap and overlapping both edges), the system will trigger the Overlap Solver menu twice in sequence. The first menu resolves the left overlap; once dismissed, the second menu appears to resolve the right overlap. Both default to the standard logic if ignored.
*   **Envelope Tweaking:** While the menu is active (and after a choice is made), Envelope Lock is temporarily bypassed, allowing the user to manually tweak the 0.5s crossfade nodes.

## 5. Focus Mode Playback
When a user selects an overlap resolution choice from the floating menu, the system automatically previews the result using **Focus Mode**.
*   **Playback Bounds:** Playback automatically starts 1.5 seconds before the 0.5s crossfade, and stops 1.5 seconds after the envelope ends (3.5 seconds total preview).
*   **Audio Ducking & Persistence:** During Focus Mode, the track currently being edited plays at normal volume. All other non-muted tracks in the project are temporarily ducked by 30% to allow the user to critically monitor the crossfade. **Focus Mode (and the 30% ducking) remains active for as long as the user is in the Overlap Solver menu**, allowing them to repeatedly preview and tweak the envelopes without the full mix interfering.

## 6. Performance Optimizations & Environment Limitations

### Audio Engine Rendering
*   **Differential Updates:** The `wavesurfer-multitrack` instance is initialized once per project structure change (e.g., adding/removing a track or phrase). It is **not** destroyed and re-created for non-structural changes like zooming, volume adjustments, or moving a clip (`startPosition`).
*   **Dynamic Syncing:** Track properties (volume, mute, solo) and clip positions are synced dynamically using library methods (e.g., `setTrackStartPosition`, `zoom`) to prevent expensive canvas redraws and UI flickering.
*   **Throttled State Updates:** The `currentTime` of the transport is polled and updated in the global store every 100ms (10fps). This provides a smooth visual playhead while significantly reducing the React render cycle overhead compared to higher frequency updates.
*   **Component Isolation:** High-frequency UI elements like the `TransportTimeDisplay` and `PlayheadSlider` are isolated into their own React components. This prevents the main `App` component from re-rendering on every `currentTime` tick.

### Development Environment (Monaco Editor)
*   **Web Worker Restriction:** The application development environment runs within a sandboxed iframe. This security measure prevents the Monaco Editor from spawning Web Workers.
*   **Main Thread Impact:** Because Web Workers are blocked, Monaco is forced to perform heavy operations (like syntax highlighting, parsing, and formatting) on the main UI thread.
*   **UI Freezes:** This limitation causes noticeable UI freezes and unresponsiveness ("long pauses") when editing code, especially in large files. This is an environmental constraint, not a flaw in the application's React or Audio Engine architecture.

## 7. Recent Changes (anchorFrame Migration — May 2026)

### What Changed
1. ✅ **AudioWorklet mandatory** — `MediaRecorder` fallback removed entirely
2. ✅ **`anchoredFrame`** stores absolute AudioContext clock frame of punch-in (`punchInUserTime_Real × sampleRate`)
3. ✅ **`startPosition = punchInUserTime - headLength`** — visual clip computed directly from UserTime, independent of anchorFrame
4. ✅ **`playAt()` offset = `playedDuration`** — plays entire buffer (head + recording) from position 0
5. ✅ **`headLength` per clip** — editable in SyncTool, stored on phrase at creation time. Single-buffer approach: rolling buffer stops trimming at `_recordingStartFrame`, `_flush()` extracts head from last `headLength` seconds before start, then includes definitive recording. No separate `_audioData` stream.
6. ✅ **`originalAnchoredFrame`** — preserved for Reset/Undo operations
7. ✅ **Metronome `headLength = 0`** — plays from buffer start, no skip
8. ✅ **AudioWorklet re-load guard** — `addModule` try/catch for second recording attempts
9. ✅ **`startupDelayMs` (150ms) + `bufferSafetyMs` (100ms)** — named constants, editable in Dangerous Settings, used in `punchInUserTime_Real` computation
10. ✅ **Incremental `addTrack`** — `addTrack` now inserts new track entries (container + wavesurfer + audio) instead of just warning. No full multitrack rebuild needed for recordings.
11. ✅ **Removed `useEffect([tracks])`** — eliminated race condition that overwrote good audio data with broken nested format. All track updates handled by `onAddPhrase` callback + `trackStructureHash` rebuild.
12. ✅ **Muted setter fix** — `WebAudioPlayer.muted` now correctly reconnects gain node on unmute. Previously, the broken reconnect condition (`!this.gainNode.context?.destination`) was always false (destination always exists), so gainNode stayed disconnected after being muted during pre-roll.
13. ✅ **Pattern-based latency calibration** — new `calibration.worklet.js` for sample-accurate rising edge detection. Test signal: 500ms sustain (wakes Bluetooth) + 5 peaks at non-regular intervals [100,140,100,100,140]ms. Pattern matching eliminates false positives. `LatencyCalibrator.ts` rewritten to use worklet + pattern matching.
14. ✅ **Metronome frame counter fix** — replaced private `this.currentFrame` with global `currentFrame` in `metronome.worklet.js`. The private counter diverged from the audio clock when Chromium skipped render quanta under CPU load (scrolling), causing permanent offset between live metronome and recorded playback. Removed `resetToFrame(0)` call from `useAudioEngine.ts` which reset metronome to frame 0 while multitrack started from `currentTime`. See `docs/devhistory.md` section J.
15. ✅ **Metronome `START_AT` + `barTempo`** — first beat now aligns to the next grid bar.beat after `currentTime + startupDelayMs`, not to raw `currentFrame`. Worklet accepts `START_AT { nextBeatFrame, beatIndex, beatsPerBar, barTempo[], barStartFrame }`. `barTempo` indexed by bar number, extensible for per-bar tempo maps. `barStartFrame` provides the AudioContext origin of bar 0 for bar-indexed lookups. `MetronomeEngine.startAt()` method added. See `docs/devhistory.md` section K.

### Files Modified
- `public/worklets/recorder.worklet.js` — single buffer approach: `_flush()` extracts head from last `headLength` seconds before `_recordingStartFrame`, rolling buffer stops trimming at capture start; no `_audioData`
- `src/audio/recording/RecordingEngine.ts` — restored `punchInUserTime_Real` computation; `punchInUserTime` for `isCurrentlyPlaying` uses store `currentTime` (fixes clip-in-future bug); named `startupDelay`/`bufferSafety` constants
- `src/lib/multitrack/webaudio.ts` — fixed `muted` setter: gainNode reconnects unconditionally on unmute (was stuck disconnected after pre-roll mute)
- `src/lib/multitrack/multitrack.ts` — `addTrack()` `else` branch now inserts new entry incrementally (no full rebuild required for recordings); non-anchored tracks get `headLength: 0`
- `src/hooks/useAudioEngine.ts` — added `trackId: track.id` to `trackOptions` for `addTrack` fallback search; async IIFE, fire-and-forget resume, sampleRate in store
- `src/App.tsx` — removed `syncedTrackIdsRef` guard, removed entire `useEffect([tracks])` race, added Dangerous Settings UI

### Replaced Approaches
- ~~`audioOffset = -(headDuration + latencySec)`~~ → `anchoredFrame` + `headLength`
- ~~`WebAudioPlayer` with `offset` param~~ → `playedDuration` offset (plays all audio)
- ~~`startPosition = anchorFrame/sr − sPB − headLength`~~ → `startPosition = punchInUserTime − headLength`
- ~~`captureImmediately` flag~~ → unconditional `_recordingStartFrame = _anchoredFrame` in worklet
```
