# Development History & Architecture Decisions

This document tracks the key technical decisions, bug fixes, and architectural shifts made during the development of the multitrack audio editor.

## 1. Recording Duration Calculation
**Problem:** Recorded clips were being saved with a duration of `0.1s`, making them impossible to select except at the very beginning of the track.
**Root Cause:** The recording duration was calculated using the transport's `currentTime` (`duration = currentTime - startTime`). When the user clicked "Stop", the transport immediately reset to `00:00.00` before the `MediaRecorder.onstop` event fired, resulting in a negative duration that was fallback-clamped to `0.1s`.
**Decision:** 
* Switched to using `performance.now()` to calculate the exact elapsed time of the recording.
* This decouples the recording duration from the visual transport playhead, ensuring accurate clip lengths regardless of transport state changes.

## 2. Clip Selection UX: Double-Tap vs. Long-Press
**Problem:** The custom "Long-Press to Select" interaction was highly unreliable, failing at different zoom levels and scroll positions.
**Root Cause:** We were trying to manually reverse-engineer Wavesurfer's pixel-to-time math (`Time = X / Zoom`). This failed because:
1. `wavesurfer-multitrack` uses a `fillParent` behavior when zoomed out, stretching the canvas and breaking the `X / Zoom` ratio.
2. The library encapsulates its canvases inside a Shadow DOM, making accurate coordinate tracking and DOM traversal extremely brittle.
**Decision:**
* **Abandoned custom coordinate math.** We stopped fighting the library's native behavior.
* **Adopted "Double-Tap to Select".** 
  * *Single Tap:* Natively handled by Wavesurfer to instantly move the playhead to the clicked location.
  * *Double Tap:* Reads the newly updated `currentTime` from the global store and selects the phrase that exists at that exact timestamp on the clicked track.
* **Added CSS `touch-action: manipulation;`** to the timeline container to prevent mobile browsers from hijacking the double-tap for page zooming.
* **Why:** This leverages Wavesurfer's highly optimized, native internal math for zooming, scrolling, and stretching, resulting in 100% accurate selections with zero custom coordinate calculations.

## 3. Shadow DOM Awareness
**Problem:** DOM queries like `container.querySelector('.canvases')` were returning `null`, causing interactions to fail silently.
**Root Cause:** `wavesurfer-multitrack` (v0.4+) attaches a Shadow Root directly to the container to encapsulate its UI.
**Decision:** Future DOM manipulations or event delegations must account for `element.shadowRoot` if interacting with Wavesurfer's internal structure, though the preference is to rely on native library events or React state wherever possible to avoid DOM coupling.

## 4. Clip Syncing and Deletion Failures
**Problem:** Clicking the sync buttons or the delete button had no effect on the clips, though the floating UI moved.
**Root Cause:** 
1. The `window.confirm` dialog in the delete handler was being blocked by the cross-origin iframe environment.
2. The `useAudioEngine` hook was trying to update `startPosition` dynamically using an undocumented `multitrackRef.current.tracks` array, which does not exist in the current version of `wavesurfer-multitrack`. This caused a silent `TypeError` that crashed the property-syncing `useEffect`.
3. The multitrack initialization `useEffect` only depended on `trackUrls` and `trackIds`. Moving a clip changes its `startPosition` but not its URL or ID, so the multitrack instance was never recreated to reflect the new position.
**Decision:**
* Removed `window.confirm` to ensure the delete action fires reliably in the iframe.
* Replaced `trackUrls` and `trackIds` dependencies with a comprehensive `trackStateHash` that includes `id`, `url`, and `startPosition`. This ensures the multitrack instance is properly recreated whenever a clip is moved or deleted.
* Implemented a `shiftAllPhrases` function in the global store. If a user tries to sync a clip to a negative time (before `00:00`), it instead clamps that clip to `0` and shifts all *other* clips forward by the negative amount, preserving relative timing.
* Refactored the volume/mute syncing logic to iterate over `multitrackRef.current.wavesurfers` using a sequential index, completely avoiding the non-existent `multitrack.tracks` array.

## 6. Clip Labeling (WaveSurfer Regions)
**Feature:** Automatically label each new recording/clip as "Take 1", "Take 2", etc., and display it on the waveform.
**Decision:**
* We will use the `wavesurfer.js` Regions plugin attached to each individual clip's WaveSurfer instance.
* The labels will be per-track (e.g., Track 1 has Take 1 & 2; Track 2 has its own Take 1).
* A "Rename" button will be added to the clip selection menu to allow users to customize the region labels.

## 7. Overlap Solver Logic
**Feature:** Handle what happens when a user drags, imports, or records a clip that overlaps an existing clip.
**Decision:**
* **Trigger:** Clips remain separate, movable entities *until* they overlap.
* **Partial Overlaps:** Triggers a floating menu with choices:
  * *Left over Right:* 0.5s fade-out to Left, 0.5s fade-in to Right.
  * *Right over Left:* 0.5s fade-out to Right, 0.5s fade-in to Left.
  * *Undo*
  * *Record same take again*
* **Mechanism:** Uses Volume Envelopes to create the crossfades. The clips remain visually overlapping (non-destructive).
* **Focus Mode:** When a choice is made, the app auto-previews 1.5s before and after the crossfade, ducking all other tracks by 30% to allow the user to critically monitor the crossfade.
* **Default Action:** If dismissed without a choice, the new clip fades IN over the old at the start, and OUT under the old at the end.

## 8. Audio Engine Optimizations & Bug Fixes
**Problem:** The application became unresponsive, playback stopped mysteriously, and waveforms scrolled backwards during recording.
**Root Cause:**
1. **Metronome Generation:** The metronome click track buffer was being regenerated on every render up to a fixed 10-minute limit, causing severe performance issues and memory leaks due to excessive `URL.createObjectURL` calls.
2. **Latency Compensation:** Shifting all existing phrases when recording started with a negative `startPos` (due to latency) caused a jarring visual "scrolling backwards" effect.
3. **Playback State Sync:** The `isPlaying` state was out of sync with the actual multitrack playback state, and fallback listeners were prematurely stopping playback.
**Decision:**
* **Optimized Metronome:** The click track buffer is now only regenerated when BPM or Time Signature changes. If only the project duration increases, new bars are simply appended to the existing buffer. The duration is dynamically calculated as `Math.max(60, duration + 60)`.
* **Improved Latency Handling:** Excess latency is now trimmed directly from the beginning of the recorded audio buffer instead of shifting all other phrases. This maintains track alignment and prevents visual jumps.
* **Reliable Playback End:** Added a mechanism to stop playback automatically when `currentTime` reaches the project `duration`, rather than relying on unreliable state syncs.
* **WaveSurfer Overrides:** Overrode `WaveSurfer.prototype.load` and `play` to catch unhandled promise rejections, and monkey-patched `getWidth` and `getScroll` for RegionsPlugin compatibility.
* **Accurate Duration:** Refined `maxDuration` calculation to ignore the metronome track, ensuring the project duration accurately reflects the user's recorded and imported audio.

## 9. Metronome and Pre-roll Implementation
**Problem:** Inconsistent metronome behavior during pre-roll and potential synchronization issues between manual clicks and rendered tracks.
**Decision:**
* **Eliminated manual metronome.** The metronome is now exclusively a pre-rendered audio track, serving as the single source of truth for synchronization.
* **Introduced "User Time" vs. "Real Time".** The project "Real Time" starts at -1 bar (Bar 0), but the user sees Bar 1 (labeled "1.1") at User Time 0:0:0.
* **Buffer Stabilization:** Recording starts at Bar 0 to allow audio buffers and UI to stabilize, with the pre-roll portion "hard trimmed" on stop.
* **UI Clamping:** The UI is hard-clamped at User Time 0 during normal playback, only revealing Bar 0 during recording from the start.
* **Why:** This simplifies synchronization to a "track syncing" problem and ensures a consistent, stable recording experience.

## 10. Audio Engine Performance Tuning (2026-03-23)
**Problem:** The application suffered from "unnecessary redraws," "flickering," and "long pauses" during interactions like dragging clips, zooming, or adjusting volume. The entire UI felt sluggish.
**Root Cause:**
1. **Nuclear Re-initialization:** The `useAudioEngine` hook included `tracks` and `zoom` in the dependency array for initializing the `wavesurfer-multitrack` instance. This meant that *any* change to a track (e.g., volume slider, mute, solo, or dragging a clip which updates `startPosition`) or zooming would completely `destroy()` and recreate the entire multitrack canvas. This was the primary cause of flickering and dropped drag events.
2. **Excessive React Rendering:** The global `useStore` was updating `currentTime` every 10ms (100fps). The main `App.tsx` component was subscribed to `currentTime`, causing the entire application tree to re-render 100 times a second during playback.
3. **Monaco Editor Limitations:** The "long pauses" during code editing were identified as an environmental limitation. The development sandbox runs in an iframe that blocks Web Workers. Monaco Editor relies heavily on Web Workers for syntax highlighting and parsing; without them, these heavy tasks run on the main UI thread, freezing the browser.
**Decision:**
* **Removed `tracks` and `zoom` from the initialization dependency array.** The multitrack instance is now only recreated when the structural hash changes (e.g., adding/removing a phrase or track).
* **Relied on Dynamic Syncing:** We verified that existing `useEffect` hooks were already correctly calling `multitrack.zoom()` and `multitrack.setTrackStartPosition()` dynamically. Removing the nuclear re-initialization allowed these dynamic methods to work as intended.
* **Throttled `currentTime`:** Reduced the polling resolution from 10ms to 100ms (10fps).
* **Component Extraction:** Extracted the `TransportTimeDisplay` and `PlayheadSlider` into separate React components. `App.tsx` no longer subscribes to `currentTime`, preventing massive re-renders and drastically improving UI responsiveness.
* **Performance Logging:** Implemented a comprehensive `PerformanceLogger` (`perfLogger`) to track and debug performance issues.
  * Added a floating `StatusLogger` component to display real-time status messages.
  * Instrumented key functions across the app (initialization, audio loading, waveform generation, metronome, rendering, syncing, recording, file import, decoding) with `perfLogger.log()`.
  * Added functionality to download a timestamped diagnostic log file.
* **Documentation:** Updated `AUDIO_LOGIC_SPECS.md` to explicitly document the Monaco Editor limitations so the user understands the source of the "long pauses" during development.

## 12. Performance Optimization & Granular Selectors (2026-03-26)
*   **What:** Refactored the main `App.tsx` and other components to use granular Zustand selectors instead of full-store destructuring.
*   **Why:** Destructuring `const { ... } = useStore()` causes the component to re-render whenever *any* part of the store changes (including `currentTime` at 10Hz). Granular selectors like `const tracks = useStore(s => s.tracks)` ensure the component only re-renders when the specific data it needs changes.
*   **Peak Pre-calculation:** Implemented `calculatePeaksAsync` in `audioUtils.ts`.
    *   **Logic:** When a recording stops or a file is imported, peaks are calculated *before* the phrase is added to the store.
    *   **Benefit:** WaveSurfer initialization is now nearly instantaneous because it doesn't have to decode and calculate peaks on the main thread during the render phase.
*   **Multitrack Optimization:** Capped `minPxPerSec` at 100 in `MultiTrack.create`.
    *   **Benefit:** Prevents canvas lag at high zoom levels by limiting the base rendering resolution.
*   **Offline Confirmation:** Verified that all assets (JS, CSS, Icons) are bundled and no external API calls are made during runtime, supporting full offline operation.
**Problem:** The app struggled when starting recording while playing, the SyncTool was misaligned, and track selection caused "Loading audio..." flickers.
**Root Cause:**
1. **SyncTool Alignment:** The SyncTool positioning logic didn't account for the timeline header height or the dynamic track heights (expanded vs. normal) correctly during scrolling.
2. **Engine Re-initialization:** The `useAudioEngine` hook was still re-initializing the entire multitrack instance when `selectedTrackId` or `timeSignature` changed because they were used as objects/arrays in the dependency array.
3. **Recording Race Condition:** `seekTo` was only updating the multitrack instance, but not the React store's `currentTime` immediately. This caused the recording logic (which reads from the store) to use a stale start time if recording was triggered immediately after a seek.
**Decision:**
* **Fixed SyncTool Positioning:** Added `timelineHeight` (20px) to the calculation and ensured it uses the correct track height constants.
* **Stabilized Engine Dependencies:** Refined the `useEffect` dependency array in `useAudioEngine` to use primitive values (`timeSignature[0]`, `timeSignature[1]`) instead of the array object. This prevents the engine from being destroyed and recreated when selecting a track.
* **Immediate Store Sync on Seek:** Updated `seekTo` to call `setCurrentTime` immediately. This ensures that any subsequent action (like recording) has access to the most up-to-date transport time.
## 13. Refining Tempo and Track Controls (2026-03-27)
**Problem:** Tempo controls (BPM) were unresponsive and difficult to use on mobile. Metronome settings were buried in standard track settings, and sliders had small hit areas.
**Root Cause:**
1. **Input Lag:** Direct state updates on every keystroke/drag caused excessive metronome re-generation and UI stutter.
2. **UX Friction:** Standard track settings modal was too generic for the metronome. Sliders required precise "grabbing" of the thumb.
3. **Performance:** Rendering the entire timeline grid at high zoom levels was CPU-intensive.
**Decision:**
* **BpmInput Component:** Created a specialized input supporting typing, scrubbing (vertical drag), and arrow keys.
* **State Sync Strategy:** Used a `key={bpm}` prop to ensure the component re-initializes from global state correctly, avoiding infinite render loops.
* **Metronome Settings Modal:** Isolated metronome controls (BPM, Signature, Volume) into a dedicated modal accessible via a gear icon. Prevented the standard track settings modal from appearing for the metronome.
* **Slider Improvements:** Increased slider hit areas to 12px (`h-3`) and implemented "click-to-jump" functionality for all range inputs (Volume, Offset, Zoom).
* **Grid Virtualization:** Implemented virtualization in `TimelineGrid.tsx` to render only visible beat/bar lines, maintaining high performance at all zoom levels.
* **Debounced Regeneration:** Metronome audio is now regenerated with a 500ms debounce to prioritize UI responsiveness during tempo adjustments.

## 14. UI Refinements & Responsive Layout (2026-03-30)
**Problem:** Track management was cluttered, solo buttons took up valuable space, and the UI didn't adapt well to different screen sizes.
**Root Cause:**
1. **Cluttered Sidebar:** Adding, removing, and reordering tracks directly in the sidebar made it feel cramped, especially on mobile.
2. **Redundant Controls:** Dedicated solo buttons occupied horizontal space that could be used for track names or other controls.
3. **Fixed Layout:** The sidebar width and track heights were relatively fixed, leading to poor usability on portrait-oriented devices or small screens.
**Decision:**
* **Centralized Track Management:** Moved all track management (adding, removing, reordering, renaming, and color picking) to a dedicated section within the main Project Settings modal.
* **Streamlined Solo Interaction:** Removed the dedicated "S" (Solo) buttons. Solo functionality is now activated by a **long-press (500ms)** on any track's "M" (Mute) button. This reduces visual clutter while maintaining full control.
* **Responsive Sidebar & Tracks:** 
    * The track sidebar now occupies a proportional **25% width** of the screen.
    * Track heights are dynamic, ensuring at least 5 tracks + the metronome fit on the screen, with a maximum height of ~150px.
* **Visual Polish:**
    * Moved the track color identifier to the **right side** of the sidebar for better visual alignment with the waveforms.
    * Reduced top and bottom margins for the header and tracks to maximize the vertical workspace.
    * Integrated a standard color picker for each track in the settings modal, with default colors assigned for vocal parts (Soprano: Yellow, Alto: Red, Tenor: Green, Bass: Blue).
* **Improved Interaction:** Increased the long-press threshold for opening track settings to 800ms to prevent accidental triggers during double-taps for clip selection.

## 15. Output Latency & Track Offset (2026-04-05)
**Problem:** The visual playhead was slightly ahead of the audible audio, and users needed a way to manually nudge tracks to compensate for variable hardware latency.
**Root Cause:**
1. **Visual Sync:** The `requestAnimationFrame` loop was using `audioContext.currentTime` directly, which represents the time in the *output buffer*, not the time the user actually hears (which is delayed by the hardware output latency).
2. **Variable Latency:** Different output devices (Bluetooth vs. Wired) have vastly different latencies that a single global setting might not perfectly cover for every take.
**Decision:**
* **Implemented `outputLatency` Compensation:** In `multitrack.ts`, the playhead position is now calculated as `now - startAudioTime - outputLatency`. This aligns the visual cursor with the audible sound.
* **Enabled Track-Level Offsets:** The `offset` property in the track store is now applied during the `startPosition` calculation in `useAudioEngine.ts`. This allows users to "nudge" individual tracks forward or backward by milliseconds.
* **Sample-Accurate Playback:** Verified that `WebAudioPlayer` uses `AudioBufferSourceNode`, which is handled by the system's high-priority audio thread. This ensures playback is sample-accurate and immune to JavaScript main-thread jitter (micro-silences).

## 16. Lyrics Builder integration (2026-04-20)
**Problem:** A separate workflow was required to map lyrics and their specific voicings to the recorded multitrack sessions, maintaining synchronization while keeping the multitrack features intact.
**Decision:**
* **Decoupled Lyrics UI Layer:** Created a completely decoupled `LyricsBuilder.tsx` screen that is easily toggled via the `appMode` state ('mixer' | 'lyrics'). When active, the multitrack timeline is hidden but WebAudio instances run intact.
* **Component-Level VAD Visualization:** Developed `VerticalHeatmap.tsx`. This avoids heavy re-decisions by utilizing the pre-calculated `phrase.peaks` (from `audioUtils`), breaking down audio volumes block-by-block and converting the multitrack playback time to vertical sync. Visually filters silence threshold.
* **Standalone Shared Project Support:** Appended robust `projectIO.ts` encoding standard blob/arrayBuffers directly into Base64 within a monolithic `.awnn` file extension format.
* **Inline Text-Tagging Parser:** Rather than keeping parallel array trees (`VoicingSegment[]`) that decouple and glitch out easily, we migrated the styling engine into an inline tag engine. E.g: `[ALL]` and `[S]`. The parser constructs text UI nodes on the fly. Time-sync operates by adding `[T:xx.xx]` to the beginning of the text line, rendering into a `Scaled View` timeline.

## 17. Adaptive Toolbars and Raw Audio Calibration (2026-04-27)
**Feature/Fixes:** The user requested adaptive toolbars, raw audio capture, loopback latency testing, and alternative visualizations.
**Decision:**
* **Adaptive Toolbars:** Introduced 3 structural proposals (1: Sidebar, 2: Top bar, 3: Compact tray) for the `TrackToolbar`, responsive to available space and toggleable via the 'L' hotkey.
* **SVG Heatmap:** Replaced the DOM-heavy `VerticalHeatmap` div-chunks with a single `<svg>` `<path>` mathematically derived from peak data, eliminating significant React render overhead.
* **Raw Audio Settings:** Defaulted `rawRecordingMode` to `true` (echo cancellation, noise suppression, AGC off). Exposed this as an Advanced Audio setting.
* **Latency Loopback Guide:** Transformed the `ManualCalibrationModal` into a step-by-step UI guide for aligning peaks on a recorded metronome track, including a global latency offset slider for real-time visual adjustment.

## 19. Audio Engine Stability & Constraints Hardening (2026-04-27)
**Fixes:** Auto-calibration was unstable (up to 580ms latencies), and "Raw" audio capture was still being subjected to ducking/AGC by the browser. The loopback guide was blocking the screen.
**Decision:**
* **Auto-Calibration Logic:** Identified that huge latencies (500ms+) were caused by the `onaudioprocess` loop missing the beep and instead triggering on background room noise indefinitely. Added a 400ms hard timeout. Brought threshold up to `0.1` (midpoint).
* **Loopback UX:** Moved Loopback Latency Test out of the global settings into Advanced Settings. Refactored the Loopback modal to be a non-blocking floating panel in the bottom-right corner, so the user can interactively adjust the slider while watching the timeline shift behind it.
 * **Chrome `goog` Constraints:** Modern browsers heavily process audio streams even when standard `false` properties are passed for AGC and noise suppression. Rebuilt the raw audio request object to use `{ exact: false }` for W3C properties *and* appended internal WebRTC flags (`googAutoGainControl`, `googNoiseSuppression`, `googHighpassFilter`, `googTypingNoiseDetection`) to forcefully bypass native browser limiters.

## 21. audioOffset Implementation (2026-05-06)

**Problem:** Recorded audio played out of sync with other tracks. Pre-roll recordings had 1+ BAR head (not 1s), and audioOffset wasn't implemented.

**Root Causes:**
1. **AudioWorklet timing:** `START_RECORDING` sent immediately (at pre-roll start), causing recording to start too early (entire pre-roll bar captured + 1s head)
2. **Latency compensation:** Was subtracted from `startPos` (absolute), but should be RELATIVE between tracks
3. **audioOffset missing:** No mechanism to skip the 1s head during playback

**Decisions:**
1. **AudioWorklet decides start via `currentTime`:** Let AudioWorklet use its own `currentTime` to decide when to start recording (1s before `punchInUserTime_Real`). No delays from main thread.
2. **`audioOffset = -(headDuration + latencySec)`:** Store skip amount in phrase data. `WebAudioPlayer` uses this to skip head during playback.
3. **`startPos = punchInUserTime`:** Clip appears at correct visual position (where user pressed Record).
4. **NO trimming:** Keep 1s head in audio buffer for future offset adjustment or fade-in.

**Implementation:**
1. **`public/worklets/recorder.worklet.js`:**
   - Store `punchInUserTime_Real` from main thread
   - AudioWorklet starts recording when `currentTime >= targetStartReal` (1s before `punchInUserTime_Real`)
   - Returns `performanceStartFrame` (when `punchInUserTime` was reached)

2. **`src/audio/recording/RecordingEngine.ts`:**
   - Calculate `audioOffset = -(1.0s head + latencySec)` in `handleAudioWorkletStop()` and `handleRecorderStop()`
   - Set `startPos = punchInUserTime` (correct visual position)
   - Store `audioOffset` in phrase data

3. **`src/lib/multitrack/webaudio.ts`:**
   - Add `offset` parameter to constructor
   - `playAt()` uses `this._offset` to skip head during playback

4. **`src/lib/multitrack/multitrack.ts`:**
   - Add `audioOffset?` to `SingleTrackOptions` and `TrackOptions`
   - When creating WaveSurfer instance, use `new WebAudioPlayer(audioContext, { offset: Math.abs(track.audioOffset) })` if offset exists

5. **Documentation updates:**
   - `docs/RECORDING_LOGIC.md` - Rewrote with audioOffset approach
   - `docs/AUDIO_LOGIC_SPECS.md` - Updated with audioOffset
   - `docs/REFACTORING_LOG.md` - Added Problem 5/6/7 sections

**Git Commits (branch: `backup-before-fixes`):**
```
f4b742a feat: Add audioOffset support - WebAudioPlayer skip head + latency
c57a68c feat: AudioWorklet decides start via currentTime, audioOffset with latency compensation
b32e74d fix: Simplify AudioWorklet - remove recordingStartTime, use currentFrame - sampleRate
ddff309 fix: AudioWorklet event reference bug - store recordingStartTime in class property
3a3eb32 fix: Recording 1s head + temp startPos=punchInUserTime-1s + comments + docs
a9a6976 fix: Read currentTime from store in startRecording() to avoid stale config
```

**Status:** ✅ Complete. Audio plays IN SYNC with other tracks!

---

## 22. Incremental addTrack & Muted Setter Fix (2026-05-13)

**Problem:** Every recording triggered a full multitrack rebuild (destroy + recreate all wavesurfers), and only one recorded clip produced audio during playback (plus metronome).

**Root Causes:**
1. **Full rebuild on every recording:** The `trackStructureHash` effect and the `useEffect([tracks])` both caused the entire multitrack to be destroyed and recreated whenever a new phrase was added.
2. **Race condition:** The `useEffect([tracks])` ran synchronously before the async rebuild completed, and its `addTrack` call used nested `phrases[]` format instead of flat format — overwriting good audio data with broken data.
3. **Muted setter bug:** `WebAudioPlayer.muted` setter had a broken reconnect condition (`!this.gainNode.context?.destination` is always false because `destination` always exists). When a clip was briefly muted during the pre-roll window (first RAF frames where `newTime < 0`), its `gainNode` was disconnected and NEVER reconnected.
4. **addTrack `else` was a no-op:** When `addTrack` couldn't find a track to replace by id/trackId, it just warned and did nothing — no new entry was created.

**Decisions:**
1. **Removed `useEffect([tracks])` entirely** — it was redundant. The `onAddPhrase` callback + `trackStructureHash` rebuild handle all cases.
2. **Incremental `addTrack`:** Replaced the no-op `else` branch with actual insertion code that creates a new DOM container, wavesurfer, and audio player without touching existing tracks.
3. **Added `trackId` to `trackOptions`:** The `onAddPhrase` callback now sends `trackId: track.id` so `addTrack`'s fallback `findIndex(t => t.trackId === ...)` can find phrase-ID entries by parent track.
4. **Fixed `muted` setter:** Removed the broken reconnect condition. After `disconnect()`, the node is fully detached, so `connect()` is always safe on unmute.

**Changes:**
1. **`src/App.tsx`** — Deleted the entire `useEffect([tracks])` block (lines ~237-273), which was racing with `onAddPhrase` callback and async rebuild.
2. **`src/hooks/useAudioEngine.ts`** — Added `trackId: track.id` to the `trackOptions` object passed to `addTrack`.
3. **`src/lib/multitrack/multitrack.ts`** — `addTrack()` `else` branch now inserts a new entry (container, audio, wavesurfer, dragging) instead of just warning.
4. **`src/lib/multitrack/webaudio.ts`** — `muted` setter now unconditionally calls `this.gainNode.connect(this.audioContext.destination)` on unmute.

**Result:** Recordings no longer cause full multitrack redraws. Multiple clips play simultaneously (no longer stuck at "1 + metronome"). The last 3% of audio-related bugs appear to be resolved.

**Commits:**
- `c845a6b` — fix: remove redundant [tracks] effect, addTrack now inserts new entries incrementally
- `5f473f3` — fix: muted setter never reconnects gain node after unmuting

## 20. Voicing Label Algorithm Refinement (2026-05-03)
**Problem:** When painting voicing labels on lyrics, duplicate tags appeared, and labels were added even when the same voicing already applied. The voicing tags should only exist when the voicing **changes**.

**Decision:**
* **Backward Scan:** From the word's start position, scan backwards (SOF) to find the nearest voicing tag `V`. If none, treat as default `[ALL]`.
* **"Right Before" Test:** `V` is considered "right before" the word only if between `V`'s closing `]` and the word's start there is only whitespace and/or non-voicing tags (e.g., `[T:12.5]`). No other text allowed.
* **Apply Logic:**
  - If `V === X` (same tag): do nothing for backward part; proceed to forward scan.
  - If `V ≠ X` and `V` is right before: replace `V` with `X`.
  - If `V ≠ X` and `V` not right before: insert `X` at word start.
  - If no `V`: insert `X` at word start.
* **Forward Scan:** After the word, scan forward (cross-line, EOF) and remove every `X` tag encountered until a **different** voicing tag `Y` (`Y ≠ X`) appears. Stop at `Y`.
* **Cleanup:** `setLyricsCleanText` performs line-by-line duplicate removal as a safety net, handling cases like `[S]Hello [S]World` → `[S]Hello World`.
* **Implementation:** Updated `LyricsBuilder.tsx`:
  - `setLyricsCleanText` now uses line-by-line processing to remove duplicate voicing tags with text between them.
  - `handleWordInteraction` implements the backward scan, "right before" test, backward replace/insert, and forward duplicate removal via a helper scanner.

## 23. Pattern-Based Latency Calibration (2026-05-13)

**Problem:** The previous calibration approach (regular-interval clicks + ScriptProcessorNode buffer recording) was unreliable. Bluetooth speakers have noise gates that swallow the first beep. Echoes and ambient noise triggered false peak detections. Timebase offset between ScriptProcessorNode and AudioContext caused search windows to miss the actual click positions. Results varied from 264ms to 624ms on the same run.

**Root Causes:**
1. **Noise gate on Bluetooth:** First 1-3 beeps were lost because the speaker was in standby — no sound reached the mic.
2. **No pattern differentiation:** All beeps used the same regular interval (800ms). Any noise peak within the interval could trigger a false detection.
3. **AnalyserNode avoids offset:** The new approach uses a dedicated AudioWorklet for edge detection (no ScriptProcessorNode), with `currentFrame`-based timing at sample accuracy.

**Solution — Pattern-Based Detection with AudioWorklet:**
1. **New `calibration.worklet.js`:** A dedicated AudioWorklet that monitors mic input for rising edges above a threshold. Configurable `threshold`, `minGapFrames`, and `startFrame` filtering. Returns exact AudioContext frame numbers for each detected edge.
2. **Sustain tone (500ms, 1kHz, 70%):** Plays before the measurement pattern to wake Bluetooth speakers and open the noise gate.
3. **Unique non-regular pattern:** The first beep is followed by a sequence of 5 peaks at intervals `[100, 140, 100, 100, 140]`ms (derived from bit pattern `[0,1,0,0,1]` where 0=80ms gap, 1=120ms gap). This creates an audio fingerprint that can be reliably identified even in noisy environments.
4. **Pattern matching:** Sliding window over detected edges. All 5 consecutive intervals must match the expected pattern within ±25ms tolerance. The first match wins.
5. **Same raw audio constraints** as the recording engine (`echoCancellation`, `noiseSuppression`, `autoGainControl` all disabled, plus Chrome `goog*` flags).

**Changes:**
1. **`public/worklets/calibration.worklet.js`** — NEW: rising edge detector with configurable parameters.
2. **`src/lib/audio/LatencyCalibrator.ts`** — Rewritten: uses AudioWorklet for edge detection + pattern matching. Removed ScriptProcessorNode fallback.
3. **`src/components/LatencyCalibrationModal.tsx`** — Removed `threshold` from options (now part of worklet config).
4. **`src/components/AudioEditorView.tsx`** — Removed `threshold` from options.
5. **`public/worklets/latency-detector.worklet.js`** — DELETED (replaced by calibration.worklet.js).

**Commits:**
- `6ddb68e` — fix: new auto calibration — buffer recording + peak analysis
- `ebf540a` — fix: latency calibrator — double currentTest increment, too-short timeout
- `9a2a7b8` — fix: latency calibrator AudioContext was suspended
- `649380f` — fix: calibrator getUserMedia — match raw recording constraints
- `58a56b3` — fix: calibrator — record captureStartTime from onaudioprocess
- `4c0bc14` — fix: new calibration worklet + pattern-based latency detection

## 24. Firefox Raw Audio — Research Evolution (2026-05-13)

**Problem:** Raw audio capture (`echoCancellation`, `noiseSuppression`, `autoGainControl` all disabled) worked in Chrome but was broken in Firefox. Firefox threw `OverconstrainedError` on `{ exact: false }` constraints and, when given plain `false` for all three, still applied audio processing — making calibration results unstable (28–155ms spread vs Chrome's 96–116ms).

**Root Causes:**
1. **`{ exact: false }` is Chrome-only** — Firefox throws `OverconstrainedError` if the feature can't be guaranteed.
2. **`goog*` flags are Chrome-internal** — Firefox rejects unknown constraints, crashing `getUserMedia`.
3. **`sampleRate` mismatch** — Chrome's `{ exact: false }` constraints inherently disable resampling; Firefox needs `sampleRate: ctx.sampleRate` to avoid resampling latency.
4. **`channelCountMode: 'explicit'`** on AudioWorklet nodes breaks Firefox input capture silently.

**Phase 1 — `echoCancellation: false` alone (incorrect):**
- Initial assumption was that Firefox enters WebRTC passthrough mode when only `echoCancellation: false` is set, disabling all processing as a side effect.
- Commit `6ca8e8d`, documented in the original §24.
- `getSettings()` later showed processing was still active. Theory was wrong.

**Phase 2 — All three constraints + sampleRate (correct):**
- Commit `a4ec9c2` corrected the approach.
- Firefox needs all three ideal constraints set to `false` (echo, noise, AGC) plus `sampleRate` matching the AudioContext.
- This was confirmed by `getSettings()` logging added in commit `5fa147b`.

**Final Configuration:**

| Browser | Constraints | Notes |
|---------|------------|-------|
| Chrome | `echoCancellation: { exact: false }`, `noiseSuppression: { exact: false }`, `autoGainControl: { exact: false }`, plus `goog*` flags | Required constraints + Chrome-internal WebRTC flags |
| Firefox | `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`, `sampleRate: ctx.sampleRate` | Ideal constraints all false + matching sample rate |
| Both | UA check via `/Chrome/.test(navigator.userAgent)` | All three `getUserMedia` call sites use same pattern |

**Diagnostics:** Added `getSettings()` logging after each `getUserMedia` call (commit `5fa147b`) — check browser console for `mic settings:` log to verify constraints were honored.

**Files Modified:**
- `src/audio/recording/RecordingEngine.ts` — `initializeForPlayback` and `initStream`
- `src/lib/audio/LatencyCalibrator.ts` — calibrator constraint block
- `public/worklets/calibration.worklet.js` — removed `channelCountMode: 'explicit'`

**Result:** Raw audio capture now works in both Chrome and Firefox. Calibration results are consistent across browsers. See `docs/FIREFOX_RAW_AUDIO_RESEARCH.md` for detailed findings.

## 25. AudioWorklet Metronome — Live-Scheduled Clicks (2026-05-14)

**Problem:** Pre-rendered 600s WAV metronome consumed ~50MB memory, required slow full re-encode on BPM changes, and prevented per-bar tempo/signature changes.

**Solution:** Replaced pre-rendered WAV with an AudioWorklet that generates click samples live on each `process()` call. The worklet is a pure sample-placement engine with no sin/cos/envelope math.

**Architecture:**
- `ClickRenderer` — static method on main thread that renders sine-click `Float32Array` with exponential decay envelope and baked gain
- `metronome.worklet.js` — AudioWorkletProcessor: frame counter, beat detection via modulo, typed array copy into output
- `MetronomeEngine` — scheduler wrapper, posts `SET_TEMPO`/`SET_SIGNATURE`/`ENABLE`/`RESET`/`SET_CLICK_SOUNDS` messages
- Volume baked into click samples at render time, no `GainNode`
- BPM changes applied at beat boundary, signature at bar boundary

**Zero drift guarantee:** Worklet's `currentFrame` derives from AudioContext hardware clock. Tempo/signature changes are sample-accurate (±1 sample at 44.1kHz).

**Results:**
- Memory: 50MB WAV blob → ~2KB (two Float32Array click samples)
- BPM changes: 500ms re-encode → instant message post
- Metronome track removed from multitrack entirely (sidebar shows only real tracks)
- Sync via `barLinesEnabled` TimelineGrid toggle

**Fixes during development:**
- RESET sent `nextBeatFrame = currentFrame + framesPerBeat`, delaying first click by 1 beat. Fixed: `nextBeatFrame = currentFrame`.
- Click samples truncated to 128 samples per process() buffer. Fixed: `currentClick/currentClickOffset/currentClickRemaining` state persists across process() calls.

## 26. Undo Via Record Button Long-Press (2026-05-14)

**Feature:** Record button in TrackToolbar supports 2-second long-press for undo.

**Behavior:**
| Interaction | State | Result |
|-------------|-------|--------|
| Tap Record | Idle | Start recording |
| Tap Record | Recording | Stop recording + **pause playback** |
| Long-press Record (2s) | Idle | Undo last clip: jump playhead to clip start, 200ms delay, remove clip |
| Long-press Record (2s) | Recording | No-op (tap already stops) |

**Undo state tracking:** `lastRecordingRef` stores `{ trackId, phraseId, startPosition }` of the last completed recording.

**Removed:** Redo, overlay, `removedPhraseRef`, `clearUndo` — all discarded as unnecessary complexity.

## 27. Play/Pause Behavior During Recording (2026-05-14)

**Change:** Pressing Play/Pause during recording stops recording AND pauses playback. The Record button in the toolbar also stops recording AND pauses playback.

**Rationale:** Both buttons now consistently pause when stopping a recording. The user expects the transport to freeze when dismissing a recording.

## 28. Mute Button Becomes Cancel During Recording (2026-05-14)

**Change:** The mute button in TrackToolbar changes to an amber `RotateCcw` cancel icon when recording on the active track (`isRecording && selectedTrackId === track.id`).

**Behavior:**
| Interaction | State | Result |
|-------------|-------|--------|
| Tap Mute | Idle | Toggle mute (unchanged) |
| Tap Mute (RotateCcw) | Recording | Cancel recording, **pause playback**, seek playhead to where recording started |
| Long-press Mute | Idle | Toggle solo (unchanged) |
| Long-press Mute | Recording | No-op (immediate action, no hold timer starts) |

**Also:** All seek paths are blocked during recording:
- `handleContainerClick` — already had guard
- `handleDoubleClick` — added `if (state.isRecording) return;`
- `PlayheadSlider` — `onChange` returns early if `isRecording`

No accidental playhead movement during recording.

**Commits (chronological):**
- `6ca8e8d` — fix: Firefox raw audio — use echoCancellation: false alone (incorrect)
- `59288fc` — docs: document Firefox raw audio discovery (now outdated)
- `f524e7c` — fix: Firefox — remove channelCountMode:explicit from calibrator worklet
- `a4ec9c2` — fix: Firefox raw audio — restore all three constraints (echo, noise, AGC)
- `5fa147b` — chore: add getSettings() logging to diagnose Firefox raw audio

## 29. UI Revamp — Toolbar Tier System, Elastic Tracks, Edit Text Relocation (2026-05-15)

**Branch:** `ui-revamp`

### Changes

**A. Logo Menu Modal**
- Moved the logo menu (Save/Load/Import/Settings modal) from inside the Normal layout branch to a standalone element after `</header>`, making it unconditional — works in both portrait and landscape.
- Added **Settings** option to the logo menu (with separator).
- Portrait mode now also has a logo button (compact Music icon) in the left area row 1.

**B. Toolbar Tier System (`toolbarProposal`)**
- Introduced `showTier(tier: 1|2|3)` helper: `toolbarProposal <= tier`.
- `toolbarProposal` values: 1 (expanded), 2 (compact), 3 (minimal).
- Tier mapping for the head toolbar:

  | Tier | Portrait | Normal |
  |---|---|---|
  | **1** (always) | Logo, App mode, BPM/Sig, Transport | Logo, View toggle, BPM/Sig, Transport |
  | **2** (proposal ≤ 2) | Metronome, Locks, Pre-roll, Cues, Fullscreen | Metronome mute, Locks, TransportTimeDisplay, Pre-roll, Cues, Fullscreen |
  | **3** (proposal = 1 only) | — | Zoom slider, Settings |

- Settings is now tier 3 (replaced the old `!mainToolbarAbbreviated` check).

**C. Elastic Track Heights**
- Removed `maxTrackHeight = 150` cap — tracks grow unbounded to fill available vertical space.
- `totalUnits` now uses actual track count (`tracks.filter(t => t.id !== 'metronome').length`) instead of hardcoded `5 + 0.8`.
- Removed `metronomeHeight` from `totalUnits` calculation (metronome has no visual waveform track — it's just data).
- `minTrackHeight = 40` kept as floor.

**D. Header Auto-Height**
- Header heights changed from fixed `h-10`/`h-20` to `min-h-10`/`min-h-20` so the header can grow naturally if buttons wrap.
- Removed `overflow-hidden` from header to prevent clipping.
- `headerHeight` in `handleResize` now uses `mainToolbarRef.current?.offsetHeight` (actual measured height) with fallback `isSmallPortrait ? 80 : ...` for portrait mode.

**E. TrackToolbar Horizontal Sync**
- TrackToolbar row heights now use `Math.floor(trackHeight * 1.5)` for expanded tracks, matching the timeline's exact calculation in `useAudioEngine.adjustLayout`. Previously used raw `trackHeight * 1.5` (could produce `.5` fractional pixel mismatch).

**F. Multitrack Container CSS**
- Changed from fixed `height: ${totalHeight}px` to `height: 100%; min-height: ${totalHeight}px` — the container fills its flex parent while maintaining a minimum height equal to the sum of all track rows.

**G. Settings Relocation**
- Settings button removed from portrait mode head toolbar entirely.
- In landscape/normal layout, Settings is tier 3 (only visible at `toolbarProposal === 1`).
- Settings is accessible via the logo menu in both layouts.

**H. Edit Text Button Relocation (Lyrics Mode)**
- **Portrait (2-row toolbar):** Edit Text/Done icon button in the head toolbar right area row 1, extreme right, tier 1.
- **Landscape (1-row toolbar):** Floating "Edit"/"Done" button at top-right of the lyrics text box (inside the editor container).
- Old floating buttons (`fixed top-4 left-4`) removed from `LyricsBuilder.tsx`.
- `isEditMode` state lifted from `LyricsBuilder` to `App.tsx`, passed as props.

**I. Tempo & Metronome Mute Closer Together**
- Removed the wrapper `<div>` + `ml-1` gap around the metronome mute button in the normal layout. The button is now a direct child of the BPM section's flex container, sharing the parent `gap-2` spacing.

## 29. SettingsModal CSS Columns Layout Fix (2026-05-17)

**Problem:** SettingsModal in landscape left the 2nd CSS column empty and required scrolling. `ModalShell` wraps children in CSS `columns-2`, but SettingsModal wrapped its content in a `<div className="grid grid-cols-1 min-[400px]:grid-cols-2">`. CSS columns saw a single child (the grid wrapper) → placed it entirely in column 1 → column 2 stayed empty.

**Fix:**
- Removed the grid wrapper from `SettingsModal.tsx`. Each section is now a flat `<div>` child of `ModalShell`.
- CSS columns auto-distribute the 5 sections across 2 columns. No `col-span-*` needed.
- Inner grids (e.g., Project Actions' Save/Load grid) remain — only the outer layout wrapper was removed.

**Design Principle Documented:**
- `ModalShell` owns column distribution via CSS columns. Modals must pass flat children — no grid/flex column layout at the top level.
- Documented in `docs/SPECS.md` (Architecture section), `docs/plans/modularize-modals-and-import-audio.md` (CSS Columns Layout Rule), and this entry.

## 30. Section Tags + LVL Single-Row Combo Bar Relocation (2026-05-18)

### A. Section Tags (Lyrics Mode)

**What:** Configurable plain-text `[Name]` markers inserted in lyrics for structure, rendered as styled headers in display mode. Not related to voicings/combo tags.

**Store (`useStore.ts`):**
- Added `sectionTags: string[]` state (default: `['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro']`)
- Added `setSectionTags` action
- Persisted to localforage

**Parser (`LyricsBuilder.tsx`):**
- Tokenizer regex updated from 5 groups to 6:
  ```
  (TimeTag)|(VoiceTag)|(SectionTag)|(Newline)|(Word)|(Whitespace)
  ```
- Section tag group: `(\[[A-Za-z][A-Za-z0-9\s\-]*?\])` — matches `[Name]` where name starts with a letter, allows letters/digits/spaces/hyphens.
- Placed after voice tags (already consumed known tags like `[S]`, `[ALL]`), before newlines.
- Creates element with `type: 'section-tag'`, stores raw text including brackets.

**Renderer:**
- `type: 'section-tag'` renders as:
  ```tsx
  <span className="w-full block text-[10px] font-bold text-zinc-500 italic uppercase tracking-[0.15em] mb-1 mt-2 select-none">
    {name} {/* brackets stripped */}
  </span>
  ```

**Edit Mode Insertion (`LyricsBuilder.tsx`):**
- `textareaRef` added to the textarea.
- `insertSectionTag(tagName)` reads cursor position from `textareaRef`, inserts `[TagName]\n` at cursor, then passes through `handleEditTextChange` (preserving time tag mapping).
- Button bar above textarea renders `sectionTags.filter(Boolean).map(tag => <button>[{tag}]</button>)`.

**Settings (`SettingsModal.tsx`):**
- "Section Tags" section with editable text inputs, Remove buttons, and + Add Tag button.

**Cleanup Preservation:**
- All cleanup regexes in `setLyricsCleanText` target only known voice tags (`[ALL]`, `[S]`, `[A]`, etc.) and time tags (`[T:...]`). Section tags pass through untouched.

**Why no separate cleanup hook:** The cleanup logic is inline in `LyricsBuilder.setLyricsCleanText` — no separate `useLyricsCleanText.ts` file exists.

### B. LVL — Forced Single-Row + Adaptive Combo Bar Relocation

**Problem:** Tracks used double-row layout at large track heights, wasting vertical space. The separate 2-col combo panel to the left of tracks could be removed when tracks are short, giving the lyrics viewer more width. The combo bar could then fill the empty vertical space below tracks inside the aside.

**Solution (`TrackBar.tsx`):**

**1. Force single-row for LVL:**
```tsx
const useSingleRow = mode === 'lyrics' ? true : (trackHeight * lyricsHeightMultiplier) < singleRowThreshold;
```

**2. Adaptive combo relocation via ResizeObserver:**
```tsx
const asideRef = useRef<HTMLElement>(null);
const [tracksFit, setTracksFit] = useState(false);

useEffect(() => {
  const aside = asideRef.current;
  if (!aside) return;
  const ro = new ResizeObserver(() => {
    const nonMetro = (tracks || []).filter(t => t.id !== 'metronome');
    const cap = btnSize + 6;
    const needTrackH = nonMetro.length * cap;
    const barH = btnSize + 26;
    setTracksFit(needTrackH + barH <= aside.clientHeight);
  });
  ro.observe(aside);
  return () => ro.disconnect();
}, [tracks, btnSize]);
```

**3. Layout logic:**
- **tracksFit=true** (room exists): Left 2-col panel hidden, 3-col combo bar renders below tracks inside aside.
- **tracksFit=false** (tracks overflow): Left 2-col panel shown, bottom bar hidden.
- Initial state `false` prevents flash; observer corrects on next frame.

**4. Left panel restored** as original 2-col grid with fixedComboTags + customTags + `+` button.

**5. Bottom combo bar** cloned from LVP markup: `displayTags.slice(0, 8)` + `+` in `grid grid-cols-3`.

**6. `useSingleRow` used throughout track rendering** — all tracks use the single-row `flex-row` path in lyrics mode.

### C. Key Debugging Iterations

1. **First attempt:** Measured `tracksContainerRef.scrollHeight <= aside.clientHeight`. Problem: track container fills the aside (`flex-1`), so scrollHeight always equals clientHeight. No room detected.

2. **Second attempt:** Computed track height from store values: `tracks × trackHeight + 5px each`. Problem: elastic layout grows `trackHeight` to fill space, so computed height always matches aside height.

3. **Third attempt:** DOM measurement using `scrollHeight <= aside.clientHeight - barH`. Problem: elastic layout fills space, never free room.

4. **Final fix:** Compute from fixed `btnSize` dimension (not elastic trackHeight):
   - `per-track = btnSize + 6` (button + tight padding, independent of elastic layout)
   - `barH = btnSize + 26`
   - Compare `tracks × (btnSize + 6) + (btnSize + 26) ≤ aside.clientHeight`
   - This works because buttons have a fixed minimum size regardless of elastic track expansion.

## 2026-05-20: Recording Race Condition, Latency Compensation, & Calibration Revisions

### A. `scheduleStopPlayback` Race Condition (Urgent Bug)
**Problem:** A 15s idle timer (armed at prior Play→Stop) would fire during an active recording, destroying the AudioWorklet mid-recording. `stopRecording()` then failed with "AudioWorklet not initialized".
**Root Cause:** `startRecording()` only called `cancelStopTimer()` inside `initStream()`. When the mic stream already existed (within the 15s window), `initStream()` was skipped entirely — the timer kept ticking.
**Fix:** Added `this.cancelStopTimer()` in the `else` branch of `startRecording()` when the stream already exists.
**Files:** `src/audio/recording/RecordingEngine.ts`

### B. Stale Comment Removed
**Problem:** Comment block stated "While PLAYING: headLength = 0, startPos = punchInUserTime" — contradicted actual behavior where headLength is always applied.
**Fix:** Removed the stale comment block.
**Files:** `src/audio/recording/RecordingEngine.ts`

### C. RECORDING_DELTA Diagnostic Redesigned
**Problem:** `RECORDING_DELTA` naively compared `punchInUserTime` (multitrack cursor) against `anchoredFrameTime - secondsPerBar` (AudioContext-derived) — two independent clock domains with different zero points. The ~21s delta was meaningless noise.
**Fix:** Now logs:
- `clockDomainDeltaSec` = `punchInUserTime_Real - punchInUserTime` (AudioContext vs cursor offset)
- `ctxTimeAtStop` = `audioContext.currentTime` at stop moment
- `workletFrameAgeSec` = time since anchoredFrame
- Added `punchInUserTime_Real` class field, stored at recording start.
**Files:** `src/audio/recording/RecordingEngine.ts`

### D. Latency Compensation Applied to Clip Placement
**Problem:** `globalLatencyMs` and `extraLatencyMs` were defined in `RecordingConfig`, stored in settings, and had a UI slider — but were never actually used in the clip placement formula.
**Fix:** `startPos = punchInUserTime - headLength - (globalLatencyMs + extraLatencyMs) / 1000` now shifts recorded clips earlier by the measured round-trip latency. Default 0ms = no change.
**Files:** `src/audio/recording/RecordingEngine.ts`

### E. `LatencyCalibrator` Rewritten for Multiple Tests
**Problem:** `numTests: 5` was passed in options but `runCalibration()` only ran 1 burst. The `latencies` array always had 1 entry.
**Fix:** Extracted `runSingleTest()` method. The calibrator now loops `numTests` times, collects individual latency measurements, reports how many succeeded, and averages valid results.
**Files:** `src/lib/audio/LatencyCalibrator.ts`

### F. Calibration Test Halved in Duration
**Problem:** Each test used a 500ms burst + 500ms listening window + 500ms margin = 1500ms per test. 5 tests = 7.5s.
**Fix:** Made `burstDuration` configurable via `START` message field. Halved all timing:
- Burst: 500ms → 250ms
- Post-burst listening: 500ms → 250ms
- Envelope peak offset: 250ms → 125ms
- Wait per test: 1500ms → 800ms
- Total for 5 tests: ~4s
**Files:** `public/worklets/calibration.worklet.js`, `src/lib/audio/LatencyCalibrator.ts`

### G. Auto Calibration UI Added to Settings
**Problem:** `LatencyCalibrationModal` was rendered in `App.tsx` but had no button to trigger it — orphaned code.
**Fix:**
- Replaced the Global Latency Offset slider in Settings with two buttons in a row: **"Auto Calibration"** (opens modal + auto-starts the test) and **"XXms"** (opens modal for manual tweaking).
- Added `autoStart?: boolean` prop to `LatencyCalibrationModal` — when true, a `useEffect` triggers `runAutoCalibration()` immediately on mount.
- Renamed section title to "Audio Latency Compensation".
**Files:** `src/components/modals/SettingsModal.tsx`, `src/components/modals/LatencyCalibrationModal.tsx`

### H. `docs/TODO.md` Created
- Initial entry: latency compensation now applied.
- Enhancement entry: further calibration test reduction.

### I. Calibration Rewrite: White Noise + Cross-Correlation
**Problem:** The tone-based energy-chunking approach failed on Firefox (AGC can't be fully disabled; narrow-band 1kHz tone gets squashed). Each test was 800ms × 5 = 4s. Detection was quantized to 1ms chunks.

**Fix:** Replaced the entire calibration pipeline with white noise + cross-correlation:
- **Worklet** (`calibration.worklet.js`): Seeded PRNG (Mulberry32) generates deterministic white noise. Single `START` message triggers the full sequence: [250ms wake burst] [500ms gap] [5 × (50ms burst + 400ms gap)] [200ms margin]. Mic input recorded into a ring buffer. Single `RESULT` returns the full buffer + burst schedule (transferable, zero-copy).
- **Main thread** (`LatencyCalibrator.ts`): Regenerates the same noise pattern from the seed, cross-correlates it against the recording at each burst position. Sample-accurate peak detection via sliding dot product with energy normalization. Filters out low-correlation results (< 0.3 threshold).
- **Timing**: ~3200ms total for 5 bursts. Cross-correlation adds ~50ms compute per burst.
- **Why white noise**: Spread-spectrum signal is resistant to frequency-selective AGC processing. Cross-correlation extracts known signal from noise even at very low SNR.
**Files:** `public/worklets/calibration.worklet.js`, `src/lib/audio/LatencyCalibrator.ts`

### J. Metronome Clock Drift Fix — `this.currentFrame` → Global `currentFrame`

**Problem:** The metronome worklet (`metronome.worklet.js`) maintained a private `this.currentFrame` counter, incremented manually by `step` (output buffer length) per `process()` call. Under main-thread CPU load (timeline scrolling), Chromium can skip render quanta, causing `process()` to not be called for those quanta. The private counter stopped advancing during the gap, creating a permanent offset from the real audio clock (`currentFrame`). This caused the live metronome to drift late relative to recorded playback (which uses `AudioBufferSourceNode.start(when)` scheduled at absolute `audioContext.currentTime` — immune to main-thread jitter).

**Symptoms reported:**
- Live metronome and recorded metronome keep sync at rest, but offset widens during scrolling (permanent jump, not continuous drift)
- BPM/time signature changes during playback behave erratically
- Time signature sometimes refuses to change (downbeat detection uses wrong frame base)
- BPM wrong on recorded takes (metronome reset to frame 0 while multitrack starts from `currentTime`)

**Root cause:** `this.currentFrame` and the global `currentFrame` diverge whenever a render quantum is skipped. Once behind, the metronome's beat schedule (`nextBeatFrame`) never catches up, and all subsequent beats are late by the accumulated offset.

**Fix (4 hunks in `metronome.worklet.js`):**
1. **Constructor:** Removed `this.currentFrame = 0;` — the global `currentFrame` is now the single source of truth.
2. **CONFIGURE handler:** `this.nextBeatFrame = currentFrame` instead of `this.nextBeatFrame = this.currentFrame` — aligns initial beat schedule to actual audio clock.
3. **RESET handler:** `this.nextBeatFrame = currentFrame; this.beatIndex = Math.round(currentFrame / framesPerBeat) % beatsPerBar` instead of resetting to `data.frame || 0` — maintains bar-relative position.
4. **process():** `samplesUntilBeat = this.nextBeatFrame - currentFrame` (global) instead of `this.nextBeatFrame - this.currentFrame`. Removed `this.currentFrame += step` — the global `currentFrame` advances automatically.
5. **STATUS handler:** Reports global `currentFrame` for accurate debugging.

**Additional fix in `useAudioEngine.ts`:**
- Removed `metronomeEngineRef.current.resetToFrame(0)` — this call set the metronome to frame 0 while the multitrack playback started from `currentTime` (e.g., 10s into the song), guaranteeing desync. The metronome now aligns automatically via `currentFrame` when enabled.

**Verification:** Both `npx tsc --noEmit` and `npm run build` pass clean.

**Files modified (phase 1 — drift fix):**
- `public/worklets/metronome.worklet.js` — frame counter fix
- `src/hooks/useAudioEngine.ts` — removed `resetToFrame(0)` call

### K. Metronome First-Beat Alignment — `START_AT` + `barTempo`

**Problem after phase 1:** The metronome fired its first click at `currentFrame` (when enabled) instead of at the next musically correct bar.beat. This made the first two beats irregular (near-zero interval from start moment to beat 1), defeating the metronome's purpose as a solid time reference.

**Root cause:** Using `currentFrame` directly as the start position gives a sample-clock position, not a musical beat position. The first click must land on the next grid-aligned bar.beat after `currentTime + startupDelayMs`.

**Fix:**
1. **`metronome.worklet.js`** — Added `START_AT` message handler with `barTempo[]` + `barStartFrame` support:
   - `barTempo`: Array of `{ bpm, framesPerBeat }` indexed by bar number. Single entry today, extensible for per-bar tempo maps.
   - `barStartFrame`: AudioContext frame where project bar 0 begins.
   - At each beat boundary, `process()` checks `beatIndex / beatsPerBar` against `barTempo[]` and applies the correct per-bar frame rate. Prepares for future tempo map without logic changes.
   - Echoes `barStartFrame` and `barTempoCount` in STATUS for debugging.

2. **`MetronomeEngine.ts`** — Added `startAt(nextBeatFrame, beatIndex, beatsPerBar, barTempo, barStartFrame)` method.

3. **`useAudioEngine.ts`** — Replaced `ENABLE`-based start with grid-aligned `START_AT`:
   - Computes `nextBeatProjectTime = ceil((currentTime + startupSec) / beatDuration) × beatDuration` — first grid beat after playback + startup delay.
   - Derives `beatIndex` and `barIndex` from the project grid.
   - Converts to AudioContext frame via `ctx.currentTime + startupSec + offset`.
   - Computes `barStartFrame` (AudioContext origin of bar 0) for future bar-indexed tempo lookups.
   - Uses `startupDelayMs` (from store) as the shared guardrail — same value the recording engine uses.

**Data flow:**
```
Main thread                          Worklet
────────────────                     ──────
currentTime + startupDelayMs
→ ceil to next beat boundary         START_AT { nextBeatFrame, beatIndex,
→ barIndex = beatIndex / beatsPerBar   beatsPerBar, barTempo[], barStartFrame }
→ barTempo[barIndex].framesPerBeat     ↓
                                      process() at each beat:
                                        barCheck = floor(beatIndex / beatsPerBar)
                                        framesPerBeat = barTempo[barCheck]
```

**Verification:** `npx tsc --noEmit` and `npm run build` pass clean.

**Files modified:**
- `public/worklets/metronome.worklet.js` — added `START_AT` handler, `barTempo`/`barStartFrame` fields, per-beat bar-indexed tempo lookup
- `src/audio/metronome/MetronomeEngine.ts` — added `startAt()` method
- `src/hooks/useAudioEngine.ts` — grid-aligned `START_AT` calculation replacing `ENABLE`-based start

## L. Latency Compensation Refactor (May 2026)

### Problems
1. **`processorOptions.headLength` always undefined** — the worklet constructor never received options, so `_headLength` defaulted to 1.0s instead of the intended 0.5s. This added 500ms of excess head audio to all recordings. The 730ms `HW_COMP_MS` magic constant accidentally compensated for this (500ms head bug + 230ms real latency).
2. **`punchInUserTime_Real` removed without pre-roll offset** — the anchor switched from `punchInUserTime_Real × sr` (a future frame accounting for startupDelay + pre-roll) to raw `currentFrame` (no offset). Count-in=always clips appeared 1 bar (2s) late because the anchor was set before pre-roll played.
3. **React effect timing races** — a separate `useEffect([outputLatencyMs, baseLatencyMs])` propagated browser-reported latency to the RecordingEngine's config. The count-in=none path's 600ms `setTimeout` yielded to the event loop, allowing React to re-render and push *different* latency values between successive takes. This caused inconsistent `latencyCompMs` (182ms vs 237ms) between two otherwise identical count-in=none recordings.
4. **`devicechange` listener re-reads latency** — Firefox fires `devicechange` sporadically. The handler called `refreshAudioLatency()` which re-read `ctx.outputLatency` — which returned 0 initially but non-zero after the audio pipeline settled, changing the store values mid-session.
5. **Metronome timing had React useEffect delay** — metronome started via a `useEffect([isPlaying])` which read `audioContext.currentTime` 10–100ms after `setIsPlaying(true)`, adding jitter to the metronome's alignment with the recording anchor.

### Decision
1. **`_headLength` sent per-recording via START_RECORDING** — removes dependency on `processorOptions`. Worklet reads `event.data.headLength` on each recording.
2. **`frameOffset` for worklet anchor** — `frameOffset = startupDelay + max(0, punchInUserTime − recordStartUserTime)`. Worklet computes `_anchoredFrame = currentFrame + frameOffset`. For count-in=always: 2.15s. For count-in=None: 0.15s.
3. **Read latency from store synchronously** — removed the separate `useEffect([outputLatencyMs, baseLatencyMs])`. `RecordingEngine.handleAudioWorkletStop()` now calls `useStore.getState().outputLatencyMs`/`baseLatencyMs` directly at stop time. No React effect timing races.
4. **Removed `devicechange` listener** — latency should be read once per device at AudioContext creation, not re-read on spurious browser events.
5. **Metronome synced inline in `startRecording()`** — metronome starts synchronously using the same `audioContext.currentTime` snapshot as the recording anchor, via `onStartMetronome` callback. Guarded by `recordingMetronomeSyncedRef`.
6. **`HW_COMP_MS` = 171ms** — old 730 = 500 head bug + 230 real latency. After fixing head bug: 230. After removing 59ms of now-propagated browser latency: 171.

### Data flow (before)
```
AudioContext → setAudioContextLatency → store → useEffect([latency]) → engine.updateConfig → engine.config
                                                                                     ↓
                                              head HW_COMP_MS + engine.config.latency + extraLatency
```

### Data flow (after)
```
AudioContext → setAudioContextLatency → store
                                            ↓
                     handleAudioWorkletStop() → useStore.getState().outputLatencyMs + baseLatencyMs
                                              + HW_COMP_MS + extraLatencyMs
```

### Verification
- `npx tsc --noEmit` and `npm run build` pass clean.
- All 4 recordings from a test session: consistent `latencyCompMs` (takes 3 and 4 identical at 229/233ms; takes 1 and 2 no longer race-prone).
- Count-in=always clips no longer 1 bar late.
- Count-in=None clips no longer show 30ms take-to-take inconsistency.

### Files modified
- `public/worklets/recorder.worklet.js` — `_headLength` from `START_RECORDING.headLength`; `_anchoredFrame = currentFrame + frameOffset`
- `src/audio/recording/RecordingEngine.ts` — `frameOffset` sent in START_RECORDING; `useStore.getState()` for latency at stop time; `HW_COMP_MS` 730→230→171
- `src/hooks/useAudioEngine.ts` — removed `devicechange` listener; removed separate latency effect; metronome `onStartMetronome` callback in startRecording
- `src/store/useStore.ts` — `outputLatencyMs`/`baseLatencyMs` (existing, no change)
- `docs/AUDIO_LOGIC_SPECS.md`, `docs/RECORDING_LOGIC.md`, `TODO.md`, `AGENTS.md` — documentation updates

## M. Stale `outputLatencyMs` on First Recording

### Problem
The first recording in a session has `latencyCompMs ≈ 190` while all subsequent recordings show 228-231. This causes the first clip to be placed ~38ms later on the timeline than later clips.

### Root Cause
**`setAudioContextLatency` is called at AudioContext creation**, before any audio flows through the output device. Chrome's `AudioContext.outputLatency` getter returns ~0-8ms for a fresh context. Only after the first playback/recording does audio actually flow, and Chrome updates `outputLatency` to the real hardware value (~46ms).

The store captures the stale 8ms. `handleAudioWorkletStop()` reads from the store — so the first recording uses 8ms instead of 46ms. After the first recording plays back, something updates the store (possibly `refreshAudioLatency()` or a side effect), making subsequent recordings correct.

### Log evidence (localhost-1779411898391.log)
```
Recording 1: outputLatencyMs: 8,  latencyCompMs: 190  ← stale
Recording 2: outputLatencyMs: 46, latencyCompMs: 228
Recording 3: outputLatencyMs: 48, latencyCompMs: 230
Recording 4: outputLatencyMs: 49, latencyCompMs: 231
Recording 5: outputLatencyMs: 48, latencyCompMs: 230
```

### Planned fix
Read `outputLatency`/`baseLatency` directly from the AudioContext in `handleAudioWorkletStop()`, bypassing the store:

```ts
const outputLatencyMs = Math.round((audioContext.outputLatency || 0) * 1000);
const baseLatencyMs = Math.round((audioContext.baseLatency || 0) * 1000);
const browserLatencyMs = outputLatencyMs + baseLatencyMs;
const latencyCompMs = browserLatencyMs + HW_COMP_MS + (this.config.extraLatencyMs || 0);
```

Also remove `const storeState = useStore.getState();` and `const browserLatencyMs = (storeState.outputLatencyMs || 0) + (storeState.baseLatencyMs || 0);`.

**Rationale**: There is no React effect timing concern here — `handleAudioWorkletStop` is called from a direct message handler in the AudioWorklet callback, not from a React effect. Reading directly from the AudioContext is deterministic and always returns the latest value Chrome reports.

## N. PrecisionSeconds Increase for rAF Drift

### Problem
Scrolling and main-thread load cause `[Violation] 'requestAnimationFrame' handler took <N>ms`. When accumulated drift exceeds `precisionSeconds` (0.05s), `updatePosition` triggers `audio.currentTime = newTime` which calls `pause()+play()` on the WebAudioPlayer — an audible discontinuity.

### Fix
`precisionSeconds` increased from `0.05` to `0.3` in `multitrack.ts:427`.

**Why 300ms is safe**: `bufferNode.start(when, offset)` schedules at absolute AudioContext time — the track's playback position tracks the audio clock, not the rAF loop. The only legitimate need for drift correction is manual seeks or sustained overload, both of which produce >300ms errors.

## O. Seek Path Metronome Timebase Inconsistency

### Problem
The seek path metronome re-sync (inside `seekTo()`) used `ctx.currentTime + outputLatency + (nextBeatProjectTime - finalUserTime)` — an independent `ctx.currentTime` read, **same pattern as the original playback jitter bug**. It also didn't update the multitrack's `startAudioTime`/`startMultitrackTime` base times after seek.

### Fix (applied)
Two changes in `useAudioEngine.ts` `seekTo()`:
1. After seek during playback: update `multitrackRef.current.startAudioTime = ctx.currentTime` and `multitrackRef.current.startMultitrackTime = realTime`
2. Metronome re-sync uses `startAudioTime + outputLatency + (nextBeatRealTime - startMultitrackTime)` — same formula as the initial play sync.

The metronome now uses a consistent timebase across initial play start and seek re-sync.

## P. Remaining: OutputLatency Read at Recording Stop

### Status
**Not yet applied** — saved for next session.

See section M for the detailed plan. The change is in `RecordingEngine.ts:handleAudioWorkletStop()` — replace store read with direct AudioContext read of `outputLatency`/`baseLatency`.<｜end▁of▁thinking｜>
