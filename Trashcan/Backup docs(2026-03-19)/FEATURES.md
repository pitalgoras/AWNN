# Features Tracking

This document tracks the features discussed, planned, implemented, and discarded for the multitrack audio editor.

## Implemented
- [x] **Multitrack Rendering:** Visual representation of multiple audio tracks with waveforms.
- [x] **Playback Controls:** Global Play/Pause, Seek, and Time tracking.
- [x] **Track Controls:** Volume sliders, Mute, Solo, and active track selection.
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

## Discussed / Planned
- [x] **Latency Compensation (Data-Level):** 
  - Offset newly recorded clips by subtracting a global latency value (e.g., in milliseconds) from their `startPosition` so visuals match the audio.
  - Include a Settings UI with a manual input field for the latency value.
  - Include an "Auto-Calibrate" tool that plays a click and records it to automatically calculate the system latency.
- [x] **Import at Cursor:** 
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
- [x] **Metronome Revamp (Click Track System):**
  - Rendered click track system (1-bar clip laid consecutively/appended dynamically).
  - Dynamic length (integer number of bars).
  - Visible at the top, 40px height.
  - Grid lines show bar and beat numbers in `bar.beat` format.
  - No text name, just a metronome icon.
  - Time signature / BPM changes located in the label area (require confirmation if project not empty).
- [x] **Cues System:**
  - Add/Delete cues.
  - Cues panel toggle.
  - Cues displayed in transport bar and sidebar.
  - Bar.Beat display in transport.
- [ ] **Playback Speed Controls:**
  - Add +25% and -25% speed adjustment buttons to the transport bar.
  - Speed changes must apply seamlessly during active playback.
- [ ] **Bug Fixes (Pending):**
  - Playhead clock update continuously during playback/recording/scrolling.
  - Visual feedback & transport behavior at end of content (don't stop playback, keep recording visually).
  - Allow dragging selected clips into negative time and beyond total project length.
  - Narrower clip context menu, fine movement buttons in a sub-menu.
  - Envelope nodes hard-synced to parent clip during zoom/scroll.
  - Clip boundary detection during drag.
  - Save functionality.

## Discarded
- [x] **Playback-Level Offset for Latency:** Discarded because it causes the visual waveform to be out of sync with the audio playback, leading to a confusing UX.
