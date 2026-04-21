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

## 15. Song Builder Specification & Decisions (2026-04-21)

**Context:** After finalizing the core audio editor, we designed the companion Song Builder app (lyrics painting + alignment) and Rehearsal Player, to be integrated into the same codebase as a togglable mode.

**Key Decisions:**
- **Track‑to‑Voice Mapping:** Fixed by index (2=S, 3=A, 4=T, 5=B) with existing color customization.
- **Painting:** Drag across words to assign colors; snap to word boundaries; replace on overwrite.
- **Labeling:** `[voice]` tags remain in raw text; parsed automatically; toggle to show/hide.
- **Alignment:** Auto‑alignment with adaptive onset detection; manual via drag + tap‑to‑cue with snap.
- **Export:** Opus‑only publishing; Safari users decode Opus client‑side (no MP3 fallback).
- **Folder Interaction:** File System Access API with `browser-fs-access` fallback.
- **Manifest:** Optimistic overwrite of `songs_index.json`.
- **Rehearsal Player Features:** Basic transport, A‑B repeat, speed control, click‑lyrics navigation, solo/mute, Focus Mode with ducking.
- **UI Mode Toggle:** Header icon switches between Lyrics Builder and Audio Editor views.

**Documentation Updated:** `FEATURES.md`, `SPECS.md`, `devhistory.md`.
