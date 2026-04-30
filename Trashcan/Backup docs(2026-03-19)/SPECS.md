# Project Specifications

This document outlines the core technical specifications, architecture, and implemented features of the multitrack audio editor.

## Architecture & Tech Stack
* **Frontend:** React with TypeScript.
* **Styling:** Tailwind CSS for a modern, responsive UI.
* **Audio Engine:** `wavesurfer.js` with the `multitrack` and `regions` plugins.
* **State Management:** `zustand` for a global, reactive store.
* **Storage:** `localforage` for persistent browser-based storage of audio blobs and project metadata.
* **MIDI Handling:** `@tonejs/midi` for parsing uploaded MIDI files to extract tempo and time signature.
* **Icons:** `lucide-react` for a consistent iconography.

## Core Features
1. **Multitrack Rendering:** Visual representation of multiple audio tracks with waveforms.
2. **Playback Controls:** Global Play/Pause, Seek, and Time tracking.
3. **Track Controls:** Volume sliders, Mute, Solo, and active track selection.
4. **Audio Recording:** Record audio from the user's microphone directly into a selected track.
5. **Audio Importing:** Load local audio files into tracks (imported at current playhead position).
6. **Zooming:** Adjustable waveform zoom levels (synchronized across waveforms and envelope editor). Includes mouse scroll-wheel zoom control.
7. **Web Audio API Integration:** Shared `AudioContext` with `WebAudioPlayer` for reliable, low-latency playback.
8. **Time Sync Fix:** High-resolution polling (10ms) via `requestAnimationFrame` for smooth UI and accurate automation.
9. **Envelope Automation:** Multi-node volume automation per track with linear interpolation.
10. **Intelligent Clip Selection:** Double-click on a track selects the clip currently under the playhead.
11. **Envelope Follows Clip:** Moving a clip on the timeline automatically shifts its associated envelope nodes.
12. **Drag-to-Delete Nodes:** Envelope nodes can be deleted by dragging them far outside the track boundaries.
13. **Metronome Track:** A dedicated, thinner track (40px height) that provides a click track. It plays during the pre-roll and playback, and can be muted or volume-adjusted like any other track, but cannot be recorded onto or soloed. The timeline features a "fake 00:00:00" with a "Pre" bar to accommodate the pre-roll. The click track length is dynamic, measured in whole bars/measures, appending 1-bar rendered clips consecutively to save memory. Grid lines show bar and beat numbers in `bar.beat` format. No text name, just a metronome icon. Time signature / BPM changes are located in the label area and require user confirmation unless the project is empty.
14. **Cues System:** A system for adding and managing cues (markers) on the timeline. Cues can be added from the transport bar or the cues panel. The cues panel can be toggled on/off and allows for deleting cues. The transport bar displays the current position in both time and `Bar.Beat` format.

## Known Limitations / Workarounds
* `wavesurfer-multitrack` does not reliably emit `timeupdate` events in all environments, so a safe `requestAnimationFrame` polling mechanism is used to update the global `currentTime`.
* The library does not natively support starting an imported audio file at a specific time (it always defaults to 0). This is resolved by recreating the multitrack instance with a `startPosition` property whenever a clip is moved or imported.
* The "fake 00:00:00" timeline is achieved by visually offsetting the time display and grid by 1 bar duration, while internally the audio engine starts at `0`.
