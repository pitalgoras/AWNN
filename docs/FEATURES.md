# Features Tracking

This document tracks the features discussed, planned, implemented, and discarded for the multitrack audio editor.

## Implemented
- [x] **Multitrack Rendering:** Visual representation of multiple audio tracks with waveforms.
- [x] **Playback Controls:** Global Play/Pause, Seek, and Time tracking.
- [x] **Track Controls:** Volume sliders, Mute, Solo, and active track selection.
- [x] **Track Management in Settings:** Add, remove, reorder, and rename tracks directly from the settings modal.
- [x] **Track Color Customization:** Integrated color picker for each track in the settings page, with default colors for vocal parts (Soprano, Alto, Tenor, Bass).
- [x] **Solo via Long-Press Mute:** Streamlined UI by removing solo buttons; solo is now activated by a long-press on any track's mute button.
- [x] **Responsive Layout:** Fully adaptive UI that scales to any screen size and orientation, with dynamic track heights and a proportional sidebar (25% width).
- [x] **Reduced UI Margins:** Minimized top and bottom margins for tracks and the header to maximize vertical workspace.
- [x] **Audio Recording:** Record audio from the user's microphone directly into a selected track.
- [x] **Audio Importing:** Load local audio files into tracks (imported at current playhead position).
- [x] **Zooming:** Adjustable waveform zoom levels (synchronized across waveforms and envelope editor). Includes mouse scroll-wheel zoom control.
- [x] **Web Audio API Integration:** Shared `AudioContext` with `WebAudioPlayer` for reliable, low-latency playback.
- [x] **Time Sync Fix:** High-resolution polling (10ms) via `requestAnimationFrame` for smooth UI and accurate automation.
- [x] **Envelope Automation:** Multi-node volume automation per track with linear interpolation.
- [x] **Dynamic Layout:** Tracks expand/collapse for focused editing; waveforms automatically re-center vertically.
- [x] **Intelligent Clip Selection:** Double-click on a track selects the clip currently under the playhead.
- [x] **Envelope Follows Clip:** Moving a clip on the timeline automatically shifts its associated envelope nodes.
- [x] **Drag-to-Delete Nodes:** Envelope nodes can be deleted by dragging them far outside the track boundaries.
 - [x] **Lyrics Builder Mode:** 
   - Toggle between Multitrack and Lyrics modes natively without halting playback or discarding project data.
   - Interactive "Paint Bucket" editor that allows assigning colors (voicings) to words.
   - Voicing labels are only inserted when the voicing **changes**. The algorithm:
     1. **Backward scan** for nearest voicing tag `V`; default `[ALL]` if none.
     2. **"Right before" test**: `V` is valid only if between `V` and the word there is only whitespace and/or non-voicing tags (e.g., `[T:12.5]`).
     3. **Apply**:
        - If `V === X` (same tag): do nothing, then forward scan.
        - If `V ≠ X` and `V` is right before: replace `V` with `X`.
        - If `V ≠ X` and `V` not right before: insert `X` at word start.
        - If no `V`: insert `X` at word start.
     4. **Forward scan**: remove all subsequent `X` tags until a different voicing tag appears (cross-line allowed).
     5. **Cleanup**: `setLyricsCleanText` removes duplicate tags with text between them (line-by-line).
   - Vertical Heatmap that translates WebAudio peaks to a VAD (Voice Activity Detection) visualization per track.
- [x] **Standalone `.awnn` File Export/Import:** Support for self-contained Base64 encoded JSON project saving and loading for robust offline and server-shared architectures.

## Discussed / Planned
- [x] **Latency Compensation (Data-Level):** 
  - Offset newly recorded clips by subtracting a global latency value (e.g., in milliseconds) from their `startPosition` so visuals match the audio.
  - **Output Latency Compensation:** The visual playhead position is now compensated by the browser's `outputLatency`, ensuring the cursor matches the audible sound.
  - **Manual Track Nudge:** Each track has an `offset` property (in seconds) to manually shift its timing.
  - Includes a Settings UI with a manual input field for the latency value.
  - Includes an "Auto-Calibrate" tool that plays a click and records it to automatically calculate the system latency.
  - **Raw Recording Mode:** Option to disable audio filtering during recording. Chrome uses `{ exact: false }` constraints + `goog*` WebRTC flags. Firefox uses all three constraints (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`) with matching `sampleRate`. See `docs/FIREFOX_RAW_AUDIO_RESEARCH.md` for details.
  - **Auto-Calibrate:** Plays a single 500ms triangular-envelope burst (1kHz, 4% peak amplitude) through speakers, detects the energy peak on the mic input via 1ms sliding-window energy analysis, and computes round-trip latency. Uses same browser-specific raw audio constraints as the recording engine. Level guards warn if signal is too quiet or mic is clipping.
  - **Pattern Recognition:** The non-regular interval pattern [100, 140, 100, 100, 140]ms creates a unique audio fingerprint that eliminates false positives from echoes, ambient noise, and noise-gate artifacts. Tolerance ±25ms.
- [x] **Unified Pre-roll Behavior:** 1-bar pre-roll and hard-trimming applied to recordings (start or punch-in). Pre-roll mode can be set to "Always", "Recording Only", or "None". If already playing, recording starts immediately without count-in.
  - Import audio files at the current playhead (`currentTime`).
- [x] **Clip Labeling (WaveSurfer Regions):**
  - Use WaveSurfer Regions plugin to display labels (e.g., "Take 1", "Take 2") at the start of each clip.
  - Labels are per-track (Track 1: Take 1, Take 2; Track 2: Take 1).
  - Renaming: Add a "Rename" button to the clip selection menu to allow custom labels. (Note: Rename is planned, "Take N" is implemented)
- [ ] **Clip Consolidation Workflow (Overlap Solver):**
  - Clips remain as separate, movable entities on the track *until* they overlap.
  - When a new recording, imported clip, or dragged clip overlaps an existing clip on the same track, trigger the Overlap Solver floating menu.
  - Options: Left over Right (crossfade), Right over Left (crossfade), Undo, Record same take again.
  - Crossfades are non-destructive, using volume envelopes.
  - Focus Mode: Auto-previews 1.5s before and after the crossfade, ducking other tracks by 30%.
  - Default Action: If dismissed without a choice, the new clip fades IN over the old at the start, and OUT under the old at the end.
- [x] **Clip Management:**
  - Delete individual clips; select clips via double-click.
- [x] **Precise Clip Syncing Tool (Inline):**
  - +/- time offset buttons for fine-grained alignment.
  - Loop playback around the selected clip for auditioning.
- [x] **Envelope Visual Refinement:**
  - Visual hold lines (dashed) before the first node and after the last node to show effective volume levels.
- [x] **Node Value Normalization:**
  - Ensure envelope nodes represent a percentage of the track's base volume slider.
- [x] **Metronome Revamp (AudioWorklet):**
  - **Pre-rendered WAV replaced** with live AudioWorklet click scheduler.
  - Zero drift (±1 sample at 44.1kHz), instant BPM changes, negligible memory (~2KB).
  - **ClickRenderer** renders sine-click `Float32Array` on main thread with baked gain.
  - **metronome.worklet.js** — pure sample-placement engine. Tempo changes apply at next beat boundary, signature at next bar.
  - Metronome track removed from multitrack; sidebar shows only real audio tracks.
  - Bar/beat lines via `barLinesEnabled` TimelineGrid toggle.
  - Volume baked into samples at render time (no `GainNode`).
  - Three Settings toggles: Metronome (master), Bar Lines, Track visibility.
- [x] **Record Button Long-Press (Undo):**
  - 2-second hold on Record button removes last clip (undo). Playhead jumps to clip start, 200ms delay, clip removed.
  - Mute button during recording shows amber RotateCcw icon — tap cancels recording, pauses, seeks to recording start.
  - Play/Pause and Record buttons both stop recording AND pause playback.
  - All seek paths (slider, double-click, container click) blocked during recording.
  - No redo, no floating overlay.
- [x] **Cues System:**
  - Add/Delete cues.
  - Cues panel toggle.
  - Cues displayed in transport bar and sidebar.
  - Bar.Beat display in transport.
- [x] **Mobile-Friendly Layout:**
  - Reduced track heights (50px normal, 80px expanded) to maximize vertical space on small screens.
- [ ] **Paged Visualization (Planned):**
  - Implement a "paged" waveform renderer that only demands CPU when changing "page".
  - Background preparation of the next/previous page using a "frame buffer" to optimize CPU spikes during scrolling.
- [ ] **Playback Speed Controls:**
  - Add +25% and -25% speed adjustment buttons to the transport bar.
  - Speed changes must apply seamlessly during active playback.
- [ ] **Bug Fixes (Pending):**
  - Playhead clock update continuously during playback/recording/scrolling.
  - Allow dragging selected clips into negative time and beyond total project length.
  - Narrower clip context menu, fine movement buttons in a sub-menu.
  - Envelope nodes hard-synced to parent clip during zoom/scroll.
  - Clip boundary detection during drag.
  - Save functionality.
  - **headLength changes in Advanced Settings don't take effect until page reload** — `headLength`, `startupDelayMs`, `bufferSafetyMs` missing from engine init effect dep array.

## Discarded
- [x] **Playback-Level Offset for Latency:** Discarded because it causes the visual waveform to be out of sync with the audio playback, leading to a confusing UX.
