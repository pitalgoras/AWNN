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

## Discussed / Planned
- [x] **Latency Compensation (Data-Level):** 
  - Offset newly recorded clips by subtracting a global latency value (e.g., in milliseconds) from their `startPosition` so visuals match the audio.
  - Includes a Settings UI with a manual input field for the latency value.
  - Includes an "Auto-Calibrate" tool that plays a click and records it to automatically calculate the system latency.
  - **Raw Recording Mode:** Option to disable audio filtering during recording.
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
- [x] **Metronome Revamp (Click Track System):**
  - **No manual metronome.** Always a pre-rendered audio track (single source of truth for sync).
  - **Dedicated Metronome Settings:** A specialized modal for BPM, Time Signature, and Volume, separate from standard track settings.
  - **BpmInput Component:** High-precision input supporting typing, vertical scrubbing (drag), and arrow keys.
  - **State Synchronization:** Uses a `key` prop strategy for reactive UI updates without cascading renders.
  - **Unified Pre-roll:** 1-bar pre-roll and hard-trimming applied to ALL recordings (start or punch-in).
  - **Debounced Regeneration:** Metronome audio is only regenerated after the user finishes adjusting tempo/signature.
  - **Grid Virtualization:** Timeline grid uses virtualization to maintain performance at high zoom levels.
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
  - Visual feedback & transport behavior at end of content (don't stop playback, keep recording visually).
  - Allow dragging selected clips into negative time and beyond total project length.
  - Narrower clip context menu, fine movement buttons in a sub-menu.
  - Envelope nodes hard-synced to parent clip during zoom/scroll.
  - Clip boundary detection during drag.
  - Save functionality.

## Discarded
- [x] **Playback-Level Offset for Latency:** Discarded because it causes the visual waveform to be out of sync with the audio playback, leading to a confusing UX.

## Song Builder Features (Planned)

### Core Workflow (v1)
- [ ] **Lyrics Import/Paste:** Input raw lyrics with optional `[voice]` tags (e.g., `[S]`, `[U]`, `[S&A]`).
- [ ] **In-Text Label Parsing:** Automatically parse `[voice]` tags and apply corresponding colors; tags remain editable in text.
- [ ] **Color Palette:** 16 colors mapped to existing track colors (Soprano, Alto, Tenor, Bass + combinations). Fixed mapping by track index (customizable via Track Settings).
- [ ] **Painting Interface:** Select color → drag across words to assign voice parts. Snap to word boundaries. Painting over a segment replaces the existing color.
- [ ] **Show/Hide Labels Toggle:** Button to toggle visibility of `[voice]` tags in the lyrics view.
- [ ] **Two View Modes:** 
  - **Fixed Text:** Lyrics layout static; audio timing adjusts.
  - **Scaled Time:** Text stretches/compresses to match absolute audio time; instrumental gaps > threshold show spacer.
- [ ] **Auto-Alignment:** Energy-based onset detection with adaptive threshold per track. Prioritizes energy of the painted voice track.
- [ ] **Manual Alignment:** 
  - Drag text line start boundaries against vertical energy stripes.
  - Tap‑to‑cue: set start time at playhead with snap to singing onset.
- [ ] **Publish Snapshot:** Export song as Opus‑encoded audio files and JSON manifest using File System Access API (with fallback for Safari/Firefox).
- [ ] **Rehearsal Player:** 
  - Basic transport (Play/Pause/Stop), playhead slider.
  - A‑B repeat and speed control (0.5x – 2.0x).
  - Click on lyrics to jump playhead.
  - Solo/Mute per track + Focus Mode with audio ducking.
- [ ] **Builder/Editor Mode Toggle:** Header icon switches between Lyrics Builder (text page icon) and Audio Editor (DAW icon).

### Nice-to-Have (Post‑v1)
- [ ] Vertical energy heatmap visualization (toggleable).
- [ ] Instrumental gap spacer threshold adjustable in Advanced Settings.
- [ ] Advanced settings panel for gap threshold, onset sensitivity, etc.
- [ ] Collaborative real‑time editing.
