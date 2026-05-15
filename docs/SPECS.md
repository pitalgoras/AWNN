# Project Specifications

## Overview
A web-based multitrack audio recorder and editor designed for seamless playback, recording, and arrangement of audio clips in the browser.

## Tech Stack
* **Frontend Framework:** React 18+ with TypeScript
* **Build Tool:** Vite
* **Styling:** Tailwind CSS
* **State Management:** Zustand
* **Audio Engine:** `wavesurfer.js` (v7+) and `wavesurfer-multitrack`
* **Icons:** `lucide-react`

## Architecture
* **Global State (`useStore.ts`):** Manages the source of truth for tracks, phrases (clips), envelope nodes, playback state (isPlaying, currentTime, duration), and UI state (zoom, active track, locks).
* **Audio Engine Hook (`useAudioEngine.ts`):** Acts as the bridge between the React state and the imperative `wavesurfer-multitrack` instance. It handles:
  * Initializing the multitrack player with a shared `AudioContext` and `WebAudioPlayer` for stability.
  * Synchronizing React state changes (play/pause, volume, mute, solo) to the audio engine.
  * **Automation Loop:** A high-resolution `requestAnimationFrame` loop (10ms) that:
    * Polls the engine's current time.
    * Interpolates volume envelope values for each track based on the current time.
    * Applies the calculated volume (base volume * envelope value) to individual `WaveSurfer` instances.
  * Recording audio via the `MediaRecorder` API with high-resolution timing and latency compensation.
  * Dynamic layout synchronization via CSS variables and `setOptions` calls to keep waveforms centered during track expansion.
* **Envelope Editor (`EnvelopeEditor.tsx`):** A transparent SVG overlay that:
  * Maps envelope nodes to timeline coordinates based on `zoom` and `scrollLeft`.
  * Provides interactive node manipulation (add, drag, delete).
  * Synchronizes with the multitrack viewport's scroll events for perfect alignment.
* **Clip Consolidation Workflow:**
  * **Trigger:** When a clip is recorded, imported, or dragged such that it overlaps another clip on the same track.
  * **Process:** The workflow pauses and prompts the user to resolve overlaps sequentially.
  * **Resolution Options:** Overwrite (destructive cut), Overdub (mixdown), or Crossfade Editor (manual adjustment of linear fade-in/out sliders).
  * **Crossfade Editor UI:** Modal overlay showing zoomed-in overlapping waveforms, 2 other non-empty tracks for musical context, auto-preview (plays once, replays on parameter change), and a "Solo" button.
  * **Commit:** Once resolved, the Web Audio API (`OfflineAudioContext`) processes the audio, generates a new single `Blob`, and replaces the track's audio with the consolidated file.

## Implemented Features (Core)
1. **Multitrack Rendering:** Visual representation of multiple audio tracks with waveforms.
2. **Playback Controls:** Global Play/Pause, Seek, and Time tracking.
3. **Track Controls:** Volume sliders, Mute, Solo (via long-press on Mute), Record (per-track), and active track selection.
4. **Audio Recording:** Ability to record audio from the user's microphone directly into a track via its dedicated record button. **Unified Pre-roll Behavior:** Every recording session includes an optional 1-bar pre-roll for buffer and UI stabilization. The pre-roll mode can be set to "Always", "Recording Only", or "None". Recording actually begins 1 bar before the intended punch-in point (if pre-roll is enabled), and this pre-roll portion is "hard trimmed" upon stopping. If the application is already playing when recording is initiated, recording starts immediately at the current playhead position without any count-in, regardless of the pre-roll mode setting. This applies to all recordings, whether starting at Bar 1 or punching in at Bar 2 and beyond. This reduces synchronization issues to a single "track syncing" problem relative to the rendered metronome.
5. **Latency Compensation:** Includes a Settings UI with a manual input field for the latency value and an "Auto-Calibrate" tool that plays a single 500ms triangular-envelope burst (1kHz, 4% peak amplitude) through speakers and detects the energy peak on the mic input via 1ms sliding-window energy analysis in a dedicated AudioWorklet (`calibration.worklet.js`). Chrome uses `{ exact: false }` constraints + `goog*` WebRTC flags for raw audio; Firefox uses all three constraints (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`) with matching `sampleRate`. See `docs/FIREFOX_RAW_AUDIO_RESEARCH.md` for details. Level guards warn if the signal is too quiet or the mic is clipping. The visual playhead position is also compensated by the browser's `outputLatency` to ensure it matches the audible sound. Each track also supports a manual `offset` for fine-grained timing adjustments.
6. **Zooming:** Adjustable waveform zoom levels (synchronized across waveforms and envelope editor). Includes mouse scroll-wheel zoom control and an improved zoom slider with "click-to-jump" functionality.
7. **Web Audio API Integration:** Uses a shared `AudioContext` for reliable playback and to prevent "fetching aborted" errors on underpowered devices.
8. **Envelope Automation:** Multi-node volume automation per track with linear interpolation.
9. **Dynamic Layout:** Tracks expand/collapse for focused editing; waveforms automatically re-center vertically.
10. **Intelligent Clip Selection:** Double-click on a track selects the clip currently under the playhead.
11. **Envelope Follows Clip:** Moving a clip on the timeline automatically shifts its associated envelope nodes.
12. **Drag-to-Delete Nodes:** Envelope nodes can be deleted by dragging them far outside the track boundaries.
13. **Metronome (AudioWorklet):** Live-scheduled click generator via dedicated `metronome.worklet.js`. No pre-rendered WAV, no WaveSurfer track. `ClickRenderer` on main thread renders sine-click `Float32Array` samples with baked gain. Worklet is a pure sample-placement engine: frame counter, beat detection via modulo, typed array copy into output. Zero drift (±1 sample at 44.1kHz). BPM changes apply at beat boundary, signature at bar boundary. Instant tempo changes, ~2KB memory. Three Settings toggles: Metronome (master), Bar Lines, Track visibility. Metronome track removed from multitrack and sidebar; mute handled via header button.
14. **Cues System:** A system for adding and managing cues (markers) on the timeline. Cues can be added from the transport bar or the cues panel. The cues panel can be toggled on/off and allows for deleting cues. The transport bar displays the current position in both time and `Bar.Beat` format.
15. **Responsive & Mobile-Friendly Layout:** 
    * The track sidebar occupies a proportional **25% width** of the screen.
    * Track heights are **elastic** — no maximum cap. Tracks grow to fill all available vertical space, calculated as `(viewportHeight - headerHeight - 4) / visibleTrackCount`. Minimum 40px per track.
    * Header height adjusts dynamically (`min-h-10`/`min-h-20`) and is measured via ref rather than hardcoded.
    * Range sliders (Volume, Offset, Zoom) feature larger hit areas (`h-3`) and "click-to-jump" behavior for better touch usability.
    * Optimized vertical space with reduced header and track margins.
16. **Timeline Grid Virtualization:** The grid only renders visible beat/bar lines, ensuring smooth performance at all zoom levels.
17. **Centralized Track Management:** Adding, removing, reordering, and renaming tracks is handled within the Project Settings modal to declutter the main interface. Includes a track color picker with default vocal part assignments.
18. **Lyrics Builder Mode:** A dedicated environment to import, edit, sync, and voice lyrics.
    * Uses a string-based tagging system (e.g., `[S]`, `[ALL]`, `[T:14.5]`) seamlessly woven into `lyricsText`, avoiding desync issues with complex internal segment maps.
19. **Record Button Long-Press (Undo):** 2-second hold on Record button removes the last recorded clip. Playhead jumps to clip start, 200ms delay, clip removed. No redo, no floating overlay.
20. **Play/Pause During Recording:** Both Play/Pause and Record buttons stop recording AND pause playback. Consistent behavior.
21. **Mute Button Becomes Cancel During Recording:** Shows amber RotateCcw icon on active recording track. Tap cancels recording, pauses playback, seeks to recording start. Long-press solo disabled.
22. **Seek Paths Blocked During Recording:** PlayheadSlider, double-click, container click all return early when isRecording is true.
    * Offers side-by-side VAD (Voice Activity Detection) visualizations (`VerticalHeatmap.tsx`) generated from track audio peaks to assist mapping.
     * "Scaled View" intelligently spaces lyric lines proportional to their tagged playback times, forming a visual timeline.
     * **Voicing Label Algorithm:** Tags are only inserted when the voicing changes. The logic for applying a voicing label `X` to a word at position `startChar` is:
       1. **Backward scan:** From `startChar`, scan backwards (SOF) to find the nearest voicing tag `V` (`[ALL]`, `[S]`, `[A]`, `[T]`, `[B]`, `[S&A]`, `[T&B]`). If none, treat as default `[ALL]`.
       2. **"Right before" test:** `V` is "right before" the word if between `V`'s closing `]` and `startChar` there is only whitespace and/or non-voicing tags (e.g., `[T:12.5]`). No other text or voicing tags allowed.
       3. **Compare `V` and `X`:**
          - If `V === X`: do nothing (no duplicate). Proceed to forward scan.
          - If `V` exists and `V ≠ X`:
            - If `V` is "right before": replace `V` with `X`.
            - Else: insert `X` at `startChar`.
          - Proceed to forward scan.
          - If no `V` (default `[ALL]`): insert `X` at `startChar`, then forward scan.
       4. **Forward scan:** Starting after the word (`endChar`), scan forward (cross-line, EOF) and remove every `X` tag encountered until a **different** voicing tag `Y` (`Y ≠ X`) appears. Stop at `Y`.
       5. **Cleanup:** `setLyricsCleanText` performs line-by-line duplicate removal as a safety net (e.g., `[S]Hello [S]World` → `[S]Hello World`).
19. **AWNN Project IO:** Projects (including the Base64-encoded recorded audio buffers, cues, BPM, and lyrics) can be fully exported/imported as a unified `.awnn` (JSON) representation.

## Known Limitations / Workarounds
* `wavesurfer-multitrack` does not reliably emit `timeupdate` events in all environments, so a safe `requestAnimationFrame` polling mechanism is used to update the global `currentTime`.
* Imported audio files currently default to a start position of 0:00.
