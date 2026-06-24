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
**Problem:** The app struggled when starting recording while playing, the TakeBar was misaligned, and track selection caused "Loading audio..." flickers.
**Root Cause:**
1. **TakeBar Alignment:** The TakeBar positioning logic didn't account for the timeline header height or the dynamic track heights (expanded vs. normal) correctly during scrolling.
2. **Engine Re-initialization:** The `useAudioEngine` hook was still re-initializing the entire multitrack instance when `selectedTrackId` or `timeSignature` changed because they were used as objects/arrays in the dependency array.
3. **Recording Race Condition:** `seekTo` was only updating the multitrack instance, but not the React store's `currentTime` immediately. This caused the recording logic (which reads from the store) to use a stale start time if recording was triggered immediately after a seek.
**Decision:**
* **Fixed TakeBar Positioning:** Added `timelineHeight` (20px) to the calculation and ensured it uses the correct track height constants.
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

## P. OutputLatency Read at Recording Stop

### Status
**Applied.** `RecordingEngine.handleAudioWorkletStop()` (`src/audio/recording/RecordingEngine.ts:352-355`) reads `outputLatency`/`baseLatency` directly from the AudioContext at stop time, bypassing the stale store value. The store-based approach captured Chrome's initial 8ms report (before audio flows) — direct read always gets the settled hardware latency (~46ms after first playback).

## Q. UI Tidy — Portrait/Responsive Toolbar (2026-05-29)

### Problem
The portrait layout overflowed on narrow screens (iPhone SE 375px). Buttons were too large, padding was excessive, and the 2-row portrait layout with 3 columns had too much whitespace around the centered transport when the screen was wide enough (~500px+).

### Changes Applied

1. **Centralized `toolbarBtn()`** — Replaced scattered `getBtnClass()` patterns with a single `toolbarBtn(isSquare, extra)` helper that includes `flex items-center justify-center rounded transition-colors shrink-0` in the base class. All 20+ toolbar button instances migrated.

2. **Portrait 3-column layout** — Left column: Menu+AppMode, Pre-Roll, Metronome+BPM/Sig (BPM label stacked, centered under BPM value). Center column: transport buttons (Rewind, Stop, Play, FF) + TimeDisplay below. Right column: Cues+FS top, Locks bottom. Padding reduced: `px-4`→`px-1`, `gap-2`→`gap-1`. `min-h-20`→`min-h-32`.

3. **Play button resizing** — Size derived from `btnHeight × PLAY_MULT` (1.5 landscape, 1.2 small portrait). Icon proportionally scaled.

4. **Responsive 2-row layout (>=500px)** — Added `isWidePortrait` state tracking `windowWidth >= 500` via resize listener. When true, the portrait header switches to a 2×3 column grid:
   - **Row 1**: `| AWNN+Menu, AppMode | Rewind, Stop, Play, FF (flex-1) | Cues, FS |`
   - **Row 2**: `| Metronome, BPM/Sig, Pre-Roll | TimeDisplay (flex-1) | Locks (Move, Envelope) |`
   - Each row uses `flex items-stretch gap-1` with `min-w-[180px]` left columns and `min-w-[72px]` right columns for consistent column alignment between rows.

5. **BPM label restyled** — `BPM` label and value on the same line (e.g. `BPM 120`), time signature below. Centered in the vertical stack.

6. **Pre-Roll redesigned** — Two-line left column ("Pre" / "Roll") with state centered in remaining button width. Labels: `Pre`, `None`, `Always`, `Only Rec` (sentence case, no `uppercase`). No `min-w`.

7. **Metronome muted state** — `text-zinc-400` (not `zinc-600`), no `opacity-50` on icon.

8. **TransportTimeDisplay** — Removed `formatTime(duration)` span (always showed `00:00:00`).

9. **AWNN branding** — Menu button in 2-row layout shows `Music` icon in styled box + `AWNN` text, matching landscape layout.

### Files Modified
- `src/App.tsx` — All toolbar layout logic, `toolbarBtn()` definition, portrait landscape/2-row branches
- `src/components/TransportTimeDisplay.tsx` — Removed duration line

## R. Landscape Compact + Shared Render Functions + Elastic Columns (2026-05-29)

### Changes Applied

1. **Landscape layout restructured** — Made compact to fit iPhone SE landscape (667px):
   - Menu: icon-only via `toolbarBtn`, no AWNN text, no `w-7 h-7` icon box
   - AppMode: text-only, no icon, matching portrait style
   - BPM/Sig: static readout (portrait style) replacing clickable metronome-settings button
   - TransportTimeDisplay: removed entirely from landscape
   - Settings icon: removed (accessible via Menu modal)
   - Zoom slider: removed
   - Pre-Roll: moved from left section to right section (alongside Move Lock, Env Lock, Cues, FS)
   - Gaps tightened: `gap-2 sm:gap-4` → `gap-0.5 sm:gap-1.5` / `gap-1 sm:gap-3` → `gap-0.5 sm:gap-1`
   - Header padding: `px-2 sm:px-4` → `px-1.5`

2. **Shared render functions** — Extracted 11 render functions (`renderMenuBtn`, `renderAppModeBtn`, `renderBpmSig`, `renderMetronomeBtn`, `renderPreRollBtn`, `renderTransport`, `renderMoveLockBtn`, `renderEnvLockBtn`, `renderCuesBtn`, `renderFullscreenBtn`, `renderTimeDisplay`) defined once above `return` and used identically in all three layout branches (narrow portrait, wide portrait, landscape). Replaced ~370 lines of duplicated JSX with ~40 lines.

3. **Wide portrait 2-row height freed** — Removed `min-h-32` constraint. Height is now determined naturally by content (~64–72px), saving 56px of screen space.

4. **TimeDisplay in narrow portrait** — Pushed to the very bottom of the center column using a `flex-1` wrapper with `flex items-center justify-center`, so transport stays centered opposite rows 1-2 of adjacent columns.

5. **AWNN branding in wide portrait** — Added back `AWNN` heading text next to Menu icon in row 1 left column.

6. **Column alignment with `justify-between`** — All rows in narrow portrait left/right columns and wide portrait left columns use `justify-between`, so right edges of controls align across rows.

7. **Elastic proportional columns (wide portrait)** — Replaced `min-w-[180px]` / `min-w-[72px]` constraints with `flex-[5] flex-[5] flex-[3]` proportional ratios. Columns stretch with available space instead of being pinned to minimum widths.

8. **AppMode icon conditional** — AppMode button shows `FileText`/`Mic` icon + text everywhere except narrow portrait (<500px, text-only to save space).

9. **BPM/Sig ungrouped from Metronome** — In wide portrait row 2, MetronomeBtn, BpmSig, and PreRollBtn are all direct children of the `justify-between` flex container, spreading independently across the column.

10. **TimeDisplay bar/beat format** — Changed from `"3.2"` to `"Bar 3    Beat 2"`. Bar/beat line now uses same font size (`text-xl`), color (`text-zinc-100`), and weight (`font-light`) as the main time line.

## Q. Voicing Palette Tag ID Refactor
**Problem:** Combo tags (All, Har, S&A, T&B) in the voicing palette had no effect — tapping them always painted `[Acc]` instead of the intended combo tag.
**Root Cause:** Commit `378fea9` (TrackBar unification) moved voicing palette inline from LyricsBuilder to TrackBar. TrackBar's combo tags used blended colors (e.g. `#f5a261` for S&A) that didn't match the hardcoded color IDs in `standardVoicings` in LyricsBuilder (`#ED8936`). `handleWordInteraction` did color-based lookup which silently failed for combos and fell back to Accompaniment.
**Decision:**
- Tag text IS the ID (canonical form uses `+` separator, e.g. `[S+A]`). Color is derived from a central map, never used as identifier.
- Added central `TAG_COLOR_MAP`, `TAG_LABEL_MAP`, and helpers (`getTagColor`, `getTagLabel`, `buildComboTagId`, `buildComboLabel`, `getTrackTagLabel`) in `src/lib/utils.ts`.
- Renamed `activeColorId` → `activeTagId` in Zustand store.
- `handleWordInteraction` now uses `activeTagId` directly (no color lookup).
- Bonus: replaced mouse-only events with pointer events in `LyricsBuilder.tsx`, `MoreIconDropdown.tsx`, and `TakeBar.tsx` for touch device support.
### Files Modified
- `src/lib/utils.ts` — `TAG_COLOR_MAP`, `TAG_LABEL_MAP`, helpers
- `src/store/useStore.ts` — `activeColorId` → `activeTagId`, `setActiveColorId` → `setActiveTagId`
- `src/components/TrackBar.tsx` — tag ID based selection, canonical combo IDs
- `src/components/LyricsBuilder.tsx` — removed local maps, direct tag lookup, pointer events
- `src/components/modals/VoicingChooserModal.tsx` — shared `blendColors`, canonical IDs
- `src/components/MoreIconDropdown.tsx` — `mousedown` → `pointerdown`
- `src/components/TakeBar.tsx` — `mousedown` → `pointerdown`

## R. Dead 'D' Key Handler Removal
**Problem:** Pressing `D` in lyrics text editing mode switched the app to mixer view.
**Root Cause:** Global `keydown` listener in `src/App.tsx` (registered with `{ capture: true }`) had an `else if (e.key === 'd')` branch that called `setAppMode('mixer')`. The capture-phase listener fired before React's synthetic events, so typing 'd' into a textarea triggered both the character input and the app mode switch.
**Decision:** Removed the dead `else if (e.key === 'd')` block. The spacebar handler already guards against input elements.
### Files Modified
- `src/App.tsx` — removed dead 'd' key handler

## S. Combo Color Saturation & Custom Combo Parser Fixes
**Problem:** Three bugs in the voicing palette combo system:
1. Custom combo tag IDs were reversed (`.sort()` in `VoicingChooserModal` placed labels alphabetically)
2. Custom combo tags (e.g. `[B+S+T]`) were not recognized by the parser — the catch-all bracket group `[A-Za-z0-9\s\-]` didn't include `+`/`&`, so `B+S+T` landed as a plain word and brackets were consumed
3. Combo colors were desaturated — `blendColors` used simple RGB averaging which drifted toward gray

**Decision:**
- Removed `.sort()` from combo tag preview ID generation
- Added `+&` to the parser's catch-all bracket character class
- Replaced 8 hardcoded regex alternations with a dynamic `isVoicingTag()` helper that checks against a `tagColorMap` built from `TAG_COLOR_MAP` + `customTags`
- Rewrote `blendColors` to use HSL space with max-saturation preservation (takes the higher saturation of the two source colors instead of averaging)
- Updated hardcoded combo colors in `TAG_COLOR_MAP` to match new HSL blend
- Changed LyricsBuilder painted word text from hardcoded `'#fff'` to `getContrastColor(el.colorId)` for proper contrast on light backgrounds

### Files Modified
- `src/lib/utils.ts` — `blendColors` HSL rewrite, combo color updates
- `src/components/modals/VoicingChooserModal.tsx` — removed `.sort()`
- `src/components/LyricsBuilder.tsx` — dynamic `tagColorMap`, `isVoicingTag`, custom combo parsing, contrast text color

## T. Edit Mode Layout Fixes
**Problem:** Three issues in lyrics edit mode: textarea didn't fill available height, Edit/Done buttons were hidden in portrait mode, and on mobile the textarea overflowed the viewport width causing layout breakage and browser crash.
**Root Cause:** (1) LyricsBuilder outer div used `flex-1` but its parent was `position: absolute` (not a flex container), so flex sizing didn't apply and height collapsed to content. (2) Edit/Done buttons were gated behind `!isPortrait`, hiding them on phones. (3) Flex container chain lacked `min-w-0`, so the textarea refused to shrink below its intrinsic content width on mobile — causing overflow beyond viewport. (4) Edit mode container had no `relative`, so the Done button's `absolute` positioning was relative to the workspace div instead.
**Decision:** Changed outer div from `flex-1` to `h-full` to inherit definite height. Removed `!isPortrait` guard from both buttons. Added `min-w-0` to workspace flex container to allow proper shrinkage. Extracted `relative` to the shared className so both Edit and Done buttons position correctly.
### Files Modified
- `src/components/LyricsBuilder.tsx` — outer div `flex-1` → `h-full`, Edit/Done button visibility, `min-w-0`, `relative` fix

## U. Tabular Lyrics Edit Format & Mute Stale-Closure Fix

**Problem:** Two unrelated bugs:
1. Lyrics textarea cursor jumped on every keystroke — React controlled component reset the DOM value after `rawToTabular`/`tabularToRaw` roundtrip
2. Mute toggle inconsistently failed on fast double-tap — stale `track.isMuted` captured in render closure

**Root Cause (1):** The textarea was a controlled component (`value={editTextValue}` `onChange={...}`). On every keystroke, `tabularToRaw` → cleanup → `rawToTabular` produced a value that differed from the current DOM (empty lines got `\t\t` injected, bracket tags moved to column 2). React saw `value !== DOM`, replaced the DOM value, and reset the cursor to the end.

**Root Cause (2):** `handleMutePointerUp(e, track.id, track.isMuted)` passed `track.isMuted` captured at render time. A fast second click before re-render used the stale pre-mute value, computing the wrong toggle result. Same issue in `TrackBar.tsx` mobile mute `onClick` and `App.tsx` metronome mute `onClick`.

**Decision (1):**
- Replaced controlled `<textarea value={onChange}>` with uncontrolled `<textarea defaultValue onBlur>`
- `onBlur` calls `saveEdit()` which reads `textareaRef.current.value` directly, converts via `tabularToRaw`, and saves to store
- Done button also calls `saveEdit()` before `setIsEditMode(false)`
- Tab key handler no longer dispatches `input` event (no longer needed)
- `insertSectionTag` modifies `textarea.value` directly + calls `saveEdit()`
- Created `src/lib/lyricsFormat.ts` with `rawToTabular`, `tabularToRaw`, `normalizeVoicingTag`, `EXPANDED_TAG_MAP`
- Added `normalizeVoicingTag` to parser catch-all handler so expanded names like `[Soprano]` resolve to canonical `[S]` colors

**Decision (2):**
- Changed `handleMutePointerUp` to read `isMuted` fresh from `useStore.getState()` at event time (removed `isMuted` parameter)
- Always performs toggle (removed timer-guard skip that could silently fail on touch)
- Same fix for mobile mute `onClick` in `TrackBar.tsx` and metronome mute `onClick` in `App.tsx`

### Files Modified
- `src/lib/lyricsFormat.ts` — new file: tabular/raw converters, expanded tag map, normalize helper
- `src/components/LyricsBuilder.tsx` — uncontrolled textarea, saveEdit, parser normalization, tab key cleanup
- `src/App.tsx` — `handleMutePointerUp` fresh store read, metronome mute fresh read
- `src/components/TrackBar.tsx` — mobile mute onClick fresh store read, landscape mute handler signature

## V. Clip Alignment — Absolute RecordingStartFrame + Clock Domain Reconciliation (2026-06-11)

### Problem
Recorded clips were placed on the timeline using `punchInUserTime` (user timeline position) alone, ignoring the worklet's actual recording anchor frame. The `frameOffset` sent to the worklet was a relative value computed from an estimated `startupDelay` (150ms), and the worklet applied it as `currentFrame + frameOffset`. Three alignment-breaking issues:

1. **Relative `currentFrame + frameOffset` had two clock readings** — main thread `ctx.currentTime` for `frameOffset` vs worklet `currentFrame` for the addition. These disagree by 0-128 frames (~2.9ms render quantum boundary) because `currentFrame` in the worklet is quantized to the start of the current render quantum.

2. **`startupDelay` (150ms) was an estimate, not a measurement** — the actual playback start time after `onSetIsPlaying(true)` is unknowable from the main thread. If the actual delay was 160ms, the recording anchor was 10ms off.

3. **`handleAudioWorkletStop` ignored the worklet's `anchoredFrame`** — clip position was computed as `punchInUserTime - headLength - latencyComp`, with no reconciliation between the two clock domains. The `clockDomainDelta` was logged but never used.

### Fix
Three changes across `RecordingEngine.ts` and `recorder.worklet.js`:

**Change 1 — Absolute `recordingStartFrame` instead of relative `frameOffset`:**
Captures `audioCtxNow` at the same time for later reconciliation. The worklet stores the absolute frame directly — no `currentFrame` arithmetic on the worklet side.

**Change 2 — Worklet stores absolute frame:**
```js
this._recordingStartFrame = event.data.recordingStartFrame;
this._anchoredFrame = this._recordingStartFrame;
```

**Change 3 — Clock domain reconciliation at stop time:**
```ts
const expectedStartAudioTime = this.recordingStartCtxTime + this.recordingStartDelay + this.recordingPreRollOffset;
const actualStartAudioTime = anchoredFrame / sampleRate;
const timeError = actualStartAudioTime - expectedStartAudioTime;
const actualPunchInUserTime = this.punchInUserTime + timeError;
const startPos = actualPunchInUserTime - this.headLength - latencyCompMs / 1000;
```
The `timeError` retroactively corrects the clip position by measuring how far off the worklet's actual recording start was from the estimate.

### Files Modified
- `src/audio/recording/RecordingEngine.ts` — added tracking fields; `startRecording()` sends absolute `recordingStartFrame`; `handleAudioWorkletStop()` reconciles clock domains
- `public/worklets/recorder.worklet.js` — `START_RECORDING` handler stores `recordingStartFrame` directly
- `docs/RECORDING_LOGIC.md` — terminology and flow updated

---

## 36. Calibration Test Page — MLS Rewrite (June 2026)

### Context
The calibration test page (`tests/calibration-test/`) was experiencing hangs and false-positive readings. The primary measurement method (MLS cross-correlation) worked well in open air but failed with Bluetooth headsets where noise gates clip silence and the start of the burst.

### Changes

#### a) Single-Phase Init
**Problem**: Two-phase init (scroll/mousemove prepare → real gesture resume) had a race condition where listeners were removed before the user tapped, leaving the page stuck.
**Solution**: Single-phase — `resume()` attempted on any gesture, with one-shot click/touchstart fallback if it fails. Init listeners are removed only after completion.
**Commit**: `8fc99d4`

#### b) MLS Hang Fix — RESET + PING Drain
**Problem**: When a test's 15s timeout expired while the worklet was still `_recording = true`, the next `START` would reset state but `currentFrame` was already past the new `_startFrame`, so recording never began. Worklet remained stuck in an inactive state.
**Solution**: Added `RESET` message handler (clears all state). Each `runMlsTest()` now sends `RESET` + `PING` and waits for `PONG` before posting `START`. This drains stale messages and ensures clean worklet state before every measurement.
**Commits**: `d3a7649`

#### c) Peak-to-Noise Ratio — RMS Not Mean
**Problem**: `peakToNoiseRatio()` used arithmetic mean for the noise floor. Cross-correlation values are symmetric around zero, so the mean can be arbitrarily small, making P2N explode (138dB with wrong latency).
**Solution**: RMS gives a stable noise floor of ~`1/sqrt(N)` (~0.013 for our decimated MLS). Spurious peaks correctly score below the 18dB threshold.
**Commit**: `9b18e7c`

#### d) Geometric Amplitude Ladder + Clustering + History
**Problem**: Fixed amplitudes `[targetAmp, 0.1, 0.2, 0.4, 0.6]` were unreliable with noise gates. Single-shot P2N could spike at wrong positions. No way to cross-reference measurements.
**Solution**:
- Geometric ladder `0.05 → 0.80 ×1.5` (8 levels) — quiet for open air, loud enough for gates
- No early-stop — all amplitudes run, then latencies clustered by 5ms bins
- Winning cluster reported as `Xms ±Yms across N amplitudes` — agreement builds confidence
- localStorage history (last 5 sweeps per device combo) — cross-run consistency check
- `showGainHint()` neutralized — low noise floor is normal with Bluetooth gates, not a problem
**Commit**: `8725b71`

#### e) Feedback Toggle (Mute/Unmute)
**Problem**: The 20Hz activator tone plays continuously to keep the worklet path alive. Audible between tests.
**Solution**: "Mute Feedback" button sends `TOGGLE_FEEDBACK` to the worklet. When muted, output is silent (activator phase continues internally to avoid pop on re-enable). Tests work independently of feedback state.
**Commit**: `51fd881`

### Files Created
- `docs/CALIBRATION_TEST.md` — full architecture and decisions doc
- `.opencode/calibration-test-context.md` — agent context file

### Files Modified
- `tests/calibration-test/main.ts` — init, amplitude ladder, clustering, history, feedback toggle, neutral showGainHint
- `tests/calibration-test/test-mls.ts` — RESET + PING drain before each test
- `tests/calibration-test/analysis.ts` — RMS-based P2N
- `tests/calibration-test/index.html` — feedback toggle button
- `public/worklets/calibration-test.worklet.js` — RESET handler, TOGGLE_FEEDBACK handler, _feedbackEnabled flag

### Open Issues
- **End-detection latency**: The trailing-edge fallback (noise→silence transition) remains unreliable with noise gates that ramp down gradually. May need an alternative metric.
- **Extreme amplitudes**: 0.05 may be too quiet for some setups; 0.80 may trigger AGC on some Bluetooth headsets. The clustering approach handles this (extremes won't cluster with the middle).
- **History across sessions**: localStorage has no expiry — old results from different hardware configurations persist until overwritten. The device combo filter (`userAgent|micDeviceId`) mitigates this but browser updates change userAgent.

---

## 37. Recorder Worklet — Accumulator Buffer for Allocation Reduction (June 2026)

### Problem
`recorder.worklet.js` allocated a new `Float32Array(128)` every `process()` call (~344/s at 44100Hz). Each allocation was immediately filled via `.set()` and pushed to `_rollingBuffer`. Over a 30s recording, this produced ~10,000 small allocations — GC pressure on the real-time audio thread.

### Diagnosis
The root cause was per-call allocation of the transfer buffer. Each 128-sample block was independently allocated, filled, and pushed. The GC pauses, while short, introduced unpredictable jitter in the audio thread's timing.

### Solution
Pre-allocate a single `Float32Array(4096)` accumulator in the constructor. Input samples accumulate into this fixed buffer across successive `process()` calls. Only when the accumulator is full (every ~93ms) is it `.slice()`-ed and pushed to `_rollingBuffer`.

This cuts allocation rate from ~344/s to ~11/s — a 97% reduction.

### Additional improvements
- Input handling moved **before** the stop check in `process()`, so the last render quantum of audio is always included in the recording (previous behavior silently dropped the last 128 samples).
- `_pushAccumulator()` helper added to flush the partial chunk on stop, ensuring no samples are lost between the last full push and the stop signal.

### Tradeoffs
- **Slightly larger per-push allocations**: `.slice()` creates `Float32Array(4096)` instead of `Float32Array(128)`, but 32× fewer of them. Net allocation volume is similar (~4KB/push × 11/s ≈ 44KB/s vs ~0.5KB/push × 344/s ≈ 172KB/s — actually **less** total volume).
- **~93ms additional latency on stop**: The accumulator holds up to 4095 unwritten samples when stop arrives. `_pushAccumulator()` synchronously flushes them before `_flush()` — this delay is on the audio thread but negligible (~1 process() call worth of work).
- **Rolling buffer trimming**: During pre-roll, the accumulator can hold up to 93ms of untrimmable data (it hasn't been pushed yet). This means the effective rolling buffer can extend ~93ms beyond the nominal 2s limit. The headLength margin (max 1s) absorbs this easily — no practical impact.

### Commit
`6192893`

### Files Modified
- `public/worklets/recorder.worklet.js` — added `_accBuffer`, `_accPos`, `_accStartFrame`, `_pushAccumulator()`; reordered input handling before stop check

### Ring Buffer Consideration (ringbuf.js)
During this change, `ringbuf.js` (Paul Adenot's wait-free SPSC ring buffer using `SharedArrayBuffer`) was evaluated as an alternative. It would eliminate all allocations (not just reduce them) by sharing a pre-allocated memory region between the worklet and main thread. However, the added deployment complexity (COOP/COEP headers, Safari support flag, cross-origin resource policies) was deemed not worth it for the current app. See `docs/RINGBUF_ANALYSIS.md` for the full evaluation.

## 38. Recorder Accumulator Bugs + MultiTrack Resume-on-Seek (June 2026)

### Problem: Recording Produced Empty Clips
After the accumulator optimization (section 37), **all recordings produced zero-length clips**. `totalLength: 0` appeared in every worklet debug message regardless of recording duration. Normal playback was unaffected; only new recordings were empty.

### Root Cause: Two Bugs in Accumulator Logic (commit `6192893`)
The 4096-sample accumulator introduced in section 37 had two independent bugs that together prevented any data from reaching the rolling buffer:

**Bug 1 — Write position always `0` instead of `_accPos`** (`e170b8a`):
```js
// Before (wrong — always overwrites position 0):
this._accBuffer.set(channelData.subarray(srcOffset), 0);
// After (correct — writes at current accumulation position):
this._accBuffer.set(channelData.subarray(srcOffset), this._accPos);
```
Every `process()` call wrote 128 samples at buffer index 0, overwriting the previous call's data. Only the most recent 128 samples were ever retained.

**Bug 2 — `_accPos = tailLen` instead of `_accPos += tailLen`** (`3cf1c99`):
```js
// Before (wrong — resets to 128 on every call):
this._accPos = tailLen;
// After (correct — grows position by samples written):
this._accPos += tailLen;
```
Even after fixing the write position, `_accPos` was replaced with `tailLen` (always 128) instead of incremented. The buffer never accumulated beyond 256 total samples (128 at byte 0 from call 1, 128 at byte 128 from call 2+, with every call after call 2 overwriting call 2's data).

**Net effect:** The `_accPos >= 4096` auto-push condition never fired. `sessionPushCount` was always `1` (the final stop-time push). The single pushed 128-sample chunk had a stale `_accStartFrame` from the first-ever `process()` call (set during constructor init), which `_flush()` correctly dropped because `chunkEndFrame` was before `headCutoffFrame`.

### Safety-Net: RecordingEngine cleanup() (`71878c6`)
`handleAudioWorkletStop()` in `RecordingEngine.ts` had three early-return paths (empty data, no trackId, no AudioContext) that could leave `isRecording` stuck `true`. Added a `cleanup()` closure that calls `onSetIsRecording(false)` on ALL early-return paths, preventing state corruption when recordings silently fail.

### Problem: Clips with Head Don't Play After Rewind
After recording clips with pre-roll (head), pressing rewind during playback caused clips whose audio starts before userTime 0 to go silent. Normal play-initial was fine — the bug appeared only after a seek.

### Root Cause: MultiTrack updatePosition() Doesn't Resume Paused Audio
In `MultiTrack.updatePosition()` (`src/lib/multitrack/multitrack.ts:462-464`):
1. During playback, the rAF sync loop calls `updatePosition()` periodically
2. When a clip plays to its end (`newTime > duration`), the code pauses the individual audio element: `audio.pause()`
3. User presses rewind — `seekTo()` calls `setTime(realTime)` → `updatePosition(time)` with `time = secondsPerBar` (realTime at userTime 0)
4. For the clip: `newTime = time - realStartPosition` is now within bounds (`>= 0`, `<= duration`)
5. The code enters the `else if` branch and sets `audio.currentTime = newTime`
6. **`WebAudioPlayer.currentTime` setter** (`webaudio.ts:210-222`): checks `this.paused` — it's `true` (paused in step 2), so it only sets `this.playedDuration = newTime` but **never calls `this.play()`** to resume the audio
7. Clip remains silent despite playhead being within its bounds

### Solution: Resume Audio After Seek If Within Bounds
Added a resume check at the end of the position update loop in `MultiTrack.updatePosition()` (`multitrack.ts:470-473`):
```js
if (!isPaused && audio.paused && newTime >= 0 && newTime <= duration) {
    audio.play()
}
```
This ensures individual audio elements paused due to end-of-clip are properly resumed when seek brings the playhead back within their range.

### Commits
- `71878c6` — safety-net cleanup() in RecordingEngine
- `08634f0` — session diagnosis counters in worklet
- `e170b8a` — fix accumulator write position `0` → `_accPos`
- `3cf1c99` — fix accumulator `= tailLen` → `+= tailLen`

## 39. Calibration Test Expansion: Beep, BeepFreq, MLS Redesign, Clap v2, Early-AEC, Meta-Freq (June 2026)

### Strategic Shift
The previous calibration approach (MLS-only with cross-correlation) was reliable for open air but faced fundamental limitations with Bluetooth headsets (noise gates clipping onsets) and Firefox (AEC can't be disabled). Strategy shifted from "disable AEC" to "design AEC-proof tests."

### New Tests Added

**Beep Test (`test-beeps.ts`):**
- 5 noise bursts (4kHz bandpass, 50ms) with irregular gaps
- Trailing-edge detection resists noise gate onset truncation
- Pattern matching via `findBestShift`

**BeepFreq Test (`test-beepfreq.ts`):**
- 5 square wave bursts at tunable frequency (1–10kHz)
- Configurable bandpass filter on recording analysis
- Find the speaker-mic frequency sweet spot

**MLS Redesign (`test-mls.ts`):**
- Split into 5 segments with configurable gaps (was single burst)
- Added trailing-edge detection as primary + cross-correlation as secondary
- Geometric amplitude ladder (0.05→0.80, ×1.5, 8 levels) instead of fixed amplitudes
- Latency clustering (5ms bins) — agreement across amplitudes builds confidence
- Cross-run localStorage history (last 5 sweeps per device combo)

**Clap v2 (`test-clap.ts`):**
- Looping rhythmic pulse with half-beat-early anchor — user claps along
- Novel sound (clap) is not echo — AEC doesn't suppress it
- **Two-worklet overlapping chunks**: staggered `AudioWorkletNode` instances
- Configurable chunk size (1–5s) and silence gap (50–500ms) for AEC de-adaptation
- Start/Stop via AbortController, per-chunk live progress, cross-chunk consistency

**Early-AEC Beep Test (`test-beep-early.ts`):**
- Shorter gaps [80, 120, 180, 100]ms optimized for pre-convergence AEC window (~2–5s)
- Higher default amplitude (0.4 vs 0.3)
- Auto-runs after mic re-acquire to exploit fresh AEC filter

**Meta-Freq Scan (`test-metafreq.ts`):**
- 26 log-spaced frequencies (127Hz–10kHz, 4/octave)
- Per-frequency amplitude measurement with canvas graph
- One-per-device diagnostic (~60s)

### Infrastructure

**Two worklet nodes** — `workletNodeB` created alongside `workletNode` in `ensureWorkletReady()`, connected to both output graph and mic input. Alternating use for clap test overlapping chunks.

**Worklet additions (`calibration-test.worklet.js`):**
- `POLL` → `SNAPSHOT` handler: copies buffer on poll for non-destructive inspection (future vocal calibration use)
- `validatePeriodicity()` in `analysis.ts`: gap-pattern edge rejection

**UI additions:**
- Slider live value displays (clap BPM/chunk/gap, beep/beepfreq/early amplitude)
- Per-chunk progress in clap test (`clap-chunks-container`)
- Canvas graph for Meta-Freq scan
- AEC state display from `getSettings()`
- Device enumeration with active device highlighting
- Noise floor capture (0.5s silent recording, RMS + dBFS)
- Full Restart button (teardown + re-init)
- Re-acquire Mic button (stops stream, re-requests, auto-runs Early-AEC)
- Device change auto-reacquire via `devicechange` listener

**AEC state handling:**
- Platform-aware constraints: Chrome `{ exact: false }`, Firefox ideal false + sampleRate
- `getSettings()` confirmation displayed in status card
- Firefox raw audio limitation documented as spec-level constraint

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Clap v2 replaces clap v1 | Novel sound defeats AEC where tone-based tests fail |
| 2-worklet architecture | Overlapping chunks without gap in analysis pipeline |
| Trailing-edge over onset-edge | Bluetooth gates clip onsets, not trailing edges |
| Geometric amplitude sweep | Dense at quiet levels, sparse at stable loud levels |
| Latency clustering | Agreement across amplitudes builds confidence |

### Files Created
- `tests/calibration-test/test-beep-early.ts`
- `tests/calibration-test/test-metafreq.ts`

### Files Modified
- `tests/calibration-test/main.ts` — wiring for all 6 tests, workletNodeB, slider bindings, restart handlers, AEC state, device change
- `tests/calibration-test/index.html` — card markup for clap v2, early beep, meta-freq, restart/reacquire buttons
- `tests/calibration-test/test-clap.ts` — full rewrite: looping, 2-worklet, configurable chunks
- `tests/calibration-test/analysis.ts` — added `validatePeriodicity()`
- `public/worklets/calibration-test.worklet.js` — added POLL/SNAPSHOT handler
- `docs/CALIBRATION_TEST.md` — full architecture rewrite

## 40. Feedback Chat System (June 2026)

### Feature
Long-press feedback chat with SidebarPanel shared shell. Users can send feedback messages from the app, admins can reply, stored persistently via Vercel Blob.

### Implementation

**API endpoints:**
- `api/feedback/send.ts` — POST new feedback message, stores to Vercel Blob
- `api/feedback/messages.ts` — GET messages, returns sorted by timestamp
- `api/feedback/reply.ts` — POST admin reply
- `api/feedback/admin/threads.ts` — GET admin threads view

**UI (`FeedbackChatPanel.tsx`):**
- SidebarPanel shell with message list + input field
- Silent polling (no loading spinner on refresh)
- Merge messages on poll (no disappear on refresh)
- Cookie persistence for user identity
- Optimistic admin reply display
- Surface server error messages on send/reply failure

**Fixes:**
- `allowOverwrite: true` on blob PUT to fix 409 conflicts
- Cookie persistence + optimistic admin reply
- Error surfacing on send/reply failure

### Files Created
- `api/feedback/send.ts`
- `api/feedback/messages.ts`
- `api/feedback/reply.ts`
- `api/feedback/admin/threads.ts`
- `src/feedback/FeedbackChatPanel.tsx`
- `src/components/admin/FeedbackAdmin.tsx`

## 41. Calibration Test: Complete Wiring + Full Restart (June 2026)

### Problem
The calibration test page had all test modules implemented (`test-clap.ts`, `test-beep-early.ts`, `test-metafreq.ts`, etc.) and card markup in `index.html`, but `main.ts` was still using the old single-worklet architecture and missing handlers for the new tests.

### What Was Wired

1. **Button state arrays** — `setButtonsLoading/Ready/Failed` updated to include `btn-early`, `btn-metafreq`, `btn-reacquire-mic`, `btn-full-restart`. Failed state enables recovery buttons.

2. **`workletNodeB` creation** — Second `AudioWorkletNode` created alongside `workletNode` in `ensureWorkletReady()`, connected to output graph and mic input. Supports overlapping-chunk clap test.

3. **Clap button rewrite** — Start/Stop toggle via `AbortController`. Reads `clap-bpm`, `clap-chunk`, `clap-gap` sliders. Passes `[workletNode, workletNodeB]` array to `runClapTest()`. Shows per-chunk live progress. Displays partial results on early stop.

4. **Early beep button** — Calls `runEarlyBeepTest()` with slider amplitude, displays in `early-result`.

5. **Meta-Freq button** — Calls `runMetaFreqTest()` with progress callback, renders canvas graph, highlights best frequency.

6. **Re-acquire Mic** — Wires existing `reacquireMic()` function to `btn-reacquire-mic`.

7. **Full Restart** — Tears down everything (stops polls, aborts clap, stops mic, closes AudioContext, resets state), re-initializes.

8. **Slider live values** — `input` event listeners for `clap-bpm`, `clap-chunk`, `clap-gap`, `early-amp`.

### Verification
- `tsc && vite build` passes with zero errors.
- All 6 test cards fully functional in the calibration test page.

### Files Modified
- `tests/calibration-test/main.ts` — all wiring changes

## 42. Firefox AEC Limitation — Platform Research (June 2026)

### Finding
Firefox on Linux cannot disable AEC via Web API. This is a spec-level limitation, not a code bug:
- `{ exact: false }` for `echoCancellation` is not supported — throws `OverconstrainedError`
- `echoCancellation: false` is a non-binding target constraint per MDN spec
- PulseAudio may apply system-level AEC regardless of browser settings
- Only `about:config` flags can force-disable on Firefox

### Strategic Impact
This finding shaped the entire calibration test strategy:
1. Clap v2 became the primary test for Firefox (novel sound defeats AEC)
2. Early-AEC beep exploits the pre-convergence window when AEC filter is weak
3. Silence gaps between clap chunks partially de-adapt the AEC filter
4. Chrome/Chromium remain the reliable platform for tone-based tests

### Documentation
- `docs/FIREFOX_RAW_AUDIO_RESEARCH.md` — Detailed research findings
- `docs/CALIBRATION_TEST.md` — AEC strategy section
- `tests/calibration-test/main.ts` — Platform-aware constraints in `getUserMedia` calls<｜end▁of▁thinking｜>
