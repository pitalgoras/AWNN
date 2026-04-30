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

## 9. Metronome, Cues & UI Refinements
**Problem:** Metronome clips had "Metronome" labels, recorded clips lacked "Take N" labels, and the transport bar lacked detailed navigation.
**Decision:**
* **Metronome:** Removed the "Metronome" label from metronome phrases by setting their `name` to an empty string. Fixed the metronome track height to 40px.
* **Recorded Clip Labels:** Implemented "Take N" labeling for recorded clips using WaveSurfer Regions.
* **Cues System:** Added a system for markers (cues) with a dedicated toggleable sidebar and an "Add Cue" button in the transport bar.
* **Bar.Beat Display:** Implemented a `formatBarBeat` function to display the current position in `Bar.Beat` format in the transport bar, including a "PRE" indicator for the pre-roll.
* **Playback Stability:** Fixed an issue where playback would stop prematurely by ensuring a minimum project duration of 60 seconds for effective duration calculation.
* **Debug Logging:** Added detailed debug logs for transport actions (Play, Pause, Stop) by monkey-patching the multitrack instance methods.
