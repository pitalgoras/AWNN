# AWNN Project Chat History

This document contains a summarized and formatted log of the complete interaction history for the AWNN project (from inception to the current phase), capturing the back-and-forth, decisions, and bugs encountered.

## Phase 1: Specification & Initial Setup
* **User:** Requested to fork `replayer-pwa` to make it a multi-track editor with 5 tracks (Backtrack, Sopranos, Altos, Tenors, Basses). Must allow recording per section, sync tracks, add a metronome, and compensate for latency (Bluetooth headphones/mics). Asked to explore open-source libraries.
* **Gemini:** Noted environment constraints (React/Tailwind only, no Vue 3). Proposed building from scratch in React using `wavesurfer.js` (Multitrack plugin) and Web Audio API. Asked how to handle latency compensation.
* **User:** Chose to implement both global calibration and individual track nudging.
* **Gemini:** Asked about the workflow and cues (Upload & Mark vs. Pre-defined Grid).
* **User:** Requested both workflows. Users can upload a MIDI file to provide tempo, mark the first beat, and choose a time signature.

## Phase 2: Implementation & Bug Fixing
* **Gemini:** Implemented core engine, recording, metronome, and MIDI upload.
* **User:** Reported `TypeError: wsTrack.setVolume is not a function`.
* **Gemini:** Fixed volume control logic by targeting the correct WaveSurfer instances.
* **User:** Reported `Error accessing microphone: The request is not allowed...`
* **Gemini:** Added microphone permissions to `metadata.json`.
* **User:** Reported `The fetching process for the media resource was aborted...` and `Error: No audio loaded`.
* **Gemini:** Handled empty tracks with a silent WAV fallback, caught unhandled promise rejections, and wrapped playback methods in try-catch blocks to handle rapid re-renders.

## Phase 3: UI/UX Refinement
* **User:** Requested transport to float at the top, offset/volume in a pop-up on tap/hold, removal of "arm recording" button, metronome on transport bar, full-screen-width playhead slider, single tap to select track, double tap to mute. Empty track recording gives a count-in.
* **Gemini:** Implemented transport, playhead slider, track modals, and count-in logic.
* **User:** Requested pop-ups to close on outside click, and track buttons/waves to be graphically synced.
* **Gemini:** Fixed modal closing and track alignment.
* **User:** Defined "phrases" (clips). Every recording take becomes a phrase tied to absolute time. Overlapping clips play the latest recorded/imported. Fixed sync issues for clips recorded mid-playing.
* **Gemini:** Implemented phrase system and fixed recording sync.
* **User:** Reported importing a track stopped working.
* **Gemini:** Fixed audio import logic using `AudioContext.decodeAudioData`.
* **User:** Reported audio gaps on an underpowered PC.
* **Gemini:** Switched to the `WebAudio` backend for `wavesurfer.js` to buffer audio in memory.
* **User:** Reported visual time never worked (stuck at 00:00:00).
* **Gemini:** Implemented `requestAnimationFrame` polling for accurate time tracking.

## Phase 4: Syncing & Latency Strategy
* **User:** Brainstormed latency compensation and offsets. Requested a detailed specs document (`SPECS.md`) and features document (`FEATURES.md`).
* **Gemini:** Created docs. Asked about Data-Level Offset vs. Playback-Level Offset.
* **User:** Chose Data-Level Offset.
* **Gemini:** Asked where the Precise Clip Syncing Tool should live.
* **User:** Chose Inline controls.
* **Gemini:** Asked how to set global latency.
* **User:** Chose both manual input and auto-calibration.
* **Gemini:** Asked about importing at cursor with overlaps.
* **User:** Allow overlaps, add a feature to delete clips, and crossfade clips when overlapping is less than 4 secs.
* **Gemini:** Implemented the Precise Clip Syncing Tool with looping and offset buttons.

## Phase 5: Clip Selection & Dragging Struggles
* **User:** Reported clicking a clip doesn't select it, and playback starts from the last clip instead of the playhead.
* **Gemini:** Attempted fixes using custom hit-detection math.
* **User:** Reported selection still doesn't work. Suggested moving away from `wavesurfer-multitrack` to custom single-track instances with regions. Also proposed an "Overlap Solver" (Overwrite, Overdub, Crossfade Editor).
* **Gemini:** Discussed "Mini-WaveSurfers" approach vs. keeping `wavesurfer-multitrack`.
* **User:** Clarified the Overlap Solver: Clips remain separate *until* they overlap. Crossfade Editor should show zoomed-in waveforms, 2 non-empty tracks for context, auto-preview, and simple linear fade sliders.
* **Gemini:** Updated specs.
* **User:** Decided to stick with `wavesurfer-multitrack` since clips are glued on overlap.
* **User:** Clip selection still broken. Frustration mounted over custom coordinate math failing at different zoom levels.
* **Gemini:** Realized custom math was fighting the library's native `fillParent` and Shadow DOM.
* **User:** Suggested double-tap to select a clip, single tap to position playhead.
* **Gemini:** Adopted native double-tap, removing all custom coordinate math.
* **User:** Requested a `devhistory.md` file to track decisions.
* **Gemini:** Created `devhistory.md`.
* **User:** Reported sync buttons move the UI but not the clip. Delete button broken.
* **Gemini:** Fixed sync and delete by updating the `trackStateHash` and removing `window.confirm`.
* **User:** Asked to avoid complete re-renders on sync and add visual clip dragging.
* **Gemini:** Enabled native `draggable: true` and wired it to the React store.
* **User:** Reported dragging drops the clip mid-drag. Also noted non-overlapping clips on the same track create "sub-tracks" that break alignment.
* **Gemini:** Separated initialization dependencies from position updates to fix drag-dropping. Attempted CSS hacks (negative margins, absolute positioning) to fix the sub-track issue.

## Phase 6: The Sandbox & Final Debugging
* **User:** CSS hacks failed. Suggested creating a sandbox to debug `wavesurfer-multitrack`'s actual DOM structure.
* **Gemini:** Built a `/sandbox` route to dump the Shadow DOM.
* **User:** Provided the DOM dump, revealing there is *no* Shadow DOM and the library uses raw inline styles.
* **Gemini:** Used direct DOM manipulation (and later injected CSS with `!important`) to force overlapping clips onto the same row.
* **User:** Pointed out that analyzing the source code earlier would have saved time.
* **Gemini:** Analyzed source code, found the library injects invisible 2px borders between clips. Fixed the layout perfectly by removing `trackBorderColor`.
* **User:** Requested edge case handling: dragging to extend, overlap floating menu (Left over Right, Left under Right, Undo, Record again), default 0.5s crossfade, and Focus Mode (ducking other tracks by 30% during preview).
* **Gemini:** Implemented the Overlap Solver Debug Unit in the sandbox.
* **User:** Approved the sandbox logic. Requested integration into the main app.
* **Gemini:** Integrated Global Locks (Padlock & Envelopes) and visual transparency for overlapping clips. Fixed slow redrawing on padlock click.
* **User:** Requested auto-calibration feature and closing menus on Escape/outside click.
* **Gemini:** Implemented auto-calibrate (using microphone feedback) and modal closing logic.
* **User:** Requested visual envelope nodes and drag logic.
* **Gemini:** Implemented `EnvelopeEditor.tsx` with SVG overlays, drag-to-delete, and real-time volume interpolation.
* **User:** Reported bugs: zoom loses sync with envelopes, double-click selection broke again, envelopes don't change playback volume correctly.
* **Gemini:** Fixed zoom sync, reverted double-click to use `currentTime`, and added dashed boundary lines for envelopes.
* **User:** Double-click selection still broken ("Selected Track N (no phrase)"). Urged to stop making assumptions and use diagnostic logs.
* **Gemini:** Added a Diagnostic Trace to the double-click handler.

## Phase 7: Selection Fix & Labeling (Current)
* **User:** Provided logs showing `tracksCount: 5` and `zoom: 10` regardless of actual state, confirming a stale closure.
* **Gemini:** Fixed the stale closure by refactoring the double-click handler to pull live state directly from `useStore.getState()`.
* **User:** Confirmed selection works! Requested the previously discussed Overlap Solver and a new Labeling feature for takes (Take 1, Take 2).
* **Gemini:** Proposed using WaveSurfer Regions for labeling.
* **User:** Approved WaveSurfer Regions for labeling, with a "Rename" button in the clip selection menu. Reminded Gemini of the "Right over Left" Overlap Solver logic previously discussed.
* **Gemini:** Found the `AUDIO_LOGIC_SPECS.md` document detailing the Overlap Solver (Left over Right, Right over Left, Undo, Record same take again, Focus Mode).
* **User:** Requested to format and save the entire chat history, and update the docs with the latest decisions.

## Phase 8: Pre-roll Recording & Metronome Refinement
* **User:** Requested a pre-roll recording feature where recording starts 1 bar before the playhead position to allow for a groove to be established. The recorded audio should then be trimmed to start exactly at the punch-in time.
* **Gemini:** Implemented pre-roll logic in `useAudioEngine.ts` by adjusting the timeline seek, capturing the punch-in time, and trimming the pre-roll duration from the final audio buffer.
* **User:** Requested metronome UI/behavior refinements: make the track thinner, remove the Solo button, disallow recording on it, remove the global top bar toggle, and resolve the pre-count as non-visible metronome audio. Also requested a "fake 00:00:00" timeline where the metronome track always has 1 extra bar before 00:00:00.
* **Gemini:** Updated `TimelineGrid.tsx` and `formatTime` to display a "Pre" bar and negative times. Removed the global metronome toggle and count-in logic, relying on the metronome track's playback during the pre-roll instead. Adjusted track rendering to make the metronome track thinner and removed its Solo and Record buttons.
* **User:** Requested to remove the main recording button and instead add a recording button to each track (which selects the track and records from the time cursor).
* **Gemini:** Removed the global record button from the transport bar and added a `Mic` button to each track's header (excluding the metronome). Clicking it selects the track and toggles recording.

## Phase 9: Metronome Revamp & Bug Fixes
* **User:** Requested a complete metronome revamp: replace the timer-based metronome with a rendered click track system. The click track length should be dynamic (integer number of bars). Display it at the top, 1/3 height. Show `bar.beat` on grid lines. No text name, just an icon. Time sig/BPM controls in the label area. Also requested mouse scroll-wheel zoom, playback speed controls (+25%/-25%), and various bug fixes (playhead clock update, visual feedback at end of content, dragging into negative time, envelope nodes sync, clip boundary detection, save functionality).
* **Gemini:** Attempted to implement the metronome using a 10-minute pre-rendered buffer and real-time scheduling, which caused severe performance issues, memory leaks, and playback jitter. Also made incorrect assumptions about the pre-roll recording logic.
* **User:** Expressed frustration over the sloppy implementation, ignored instructions, and unnecessary refactoring. Clarified that the metronome should be a rendered 1-bar clip laid consecutively (appended dynamically) to save memory and allow future tempo/signature changes. Clarified the pre-roll logic: when recording, jump back 1 bar, play the metronome (and other tracks), and destructively trim the first 1 bar from the recorded clip. At time 00:00:00, use a "fake 00:00:00" where internally it's 1 bar in, allowing the pre-roll to function consistently. Also requested per-track record buttons instead of a global one.
* **Gemini:** Reverted the bad 10-minute metronome logic and asked for clarification on how to proceed with debugging the remaining issues (playback jumping, pre-roll pause bug, visual overlaps with the grid).
* **User:** Instructed Gemini to read the entire chat history, format it, add it to the dev history, update features/specs/logic based on it, and *then* ask questions to understand what is wanted and why, before implementing or fixing anything.

## Phase 10: Latency Compensation & Audio Engine Robustness (2026-04-05)
* **User:** Reported bugs: no metronome at init. Requested discussion and implementation of robust latency compensation (audio in, audio out, user input, screen update). Asked about micro-silences/jitter during playback and its impact on recording sync.
* **Gemini:** 
  * **Visual Sync ($L_{vis}$):** Updated `multitrack.ts` to incorporate `audioContext.outputLatency`. The visual playhead now subtracts this value from its position calculation, ensuring it matches what the user actually hears.
  * **Recording Sync ($L_{rt}$):** Verified the application of `globalLatencyMs` to shift recorded clips backwards, aligning them with the backing track.
  * **Manual Nudge:** Enabled the `offset` property for all tracks in `useAudioEngine.ts`, allowing users to manually adjust track timing by milliseconds.
  * **Jitter Mitigation:** Confirmed that `WebAudioPlayer`'s use of `AudioBufferSourceNode` provides sample-accurate playback, eliminating "micro-silences" caused by main-thread JS jitter.
  * **Code Quality:** Fixed a linting error in `multitrack.ts` and verified the build.
