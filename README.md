# AWNN Multitrack Audio Editor

AWNN is a powerful, web-based multitrack audio recorder and editor designed for seamless playback, recording, and automation.

## Key Features
- **Multitrack Waveform Rendering**: Visual representation of multiple audio tracks.
- **Dedicated Metronome Track**: A specialized, non-recordable track providing a pre-rendered click track for project synchronization.
- **High-Precision Tempo Control**: `BpmInput` component supporting typing, vertical scrubbing (drag), and arrow key adjustments.
- **Metronome Settings Modal**: Dedicated interface for BPM, Time Signature, and Metronome Volume.
- **Envelope Automation**: Precise volume automation per track with linear interpolation.
- **Track Management in Settings**: Add, remove, reorder, and rename tracks directly from the settings modal.
- **Track Color Customization**: Integrated color picker for each track in the settings page, with default colors for vocal parts (Soprano, Alto, Tenor, Bass).
- **Solo via Long-Press Mute**: Streamlined UI by removing solo buttons; solo is now activated by a long-press on any track's mute button.
- **Responsive Layout**: Fully adaptive UI that scales to any screen size and orientation, with dynamic track heights and a proportional sidebar.
- **High-Resolution Recording**: Unified 1-bar pre-roll for all recordings with automatic latency compensation.
- **Enhanced UI Controls**: Range sliders (Volume, Offset, Zoom) with larger hit areas and "click-to-jump" functionality.
- **Intelligent Interaction**: Double-click to select clips, drag-to-delete automation nodes, and dynamic track expansion.
- **Performance Optimized**: Timeline grid virtualization and debounced metronome regeneration for smooth UI responsiveness.

## Documentation
For detailed information on features, specifications, and audio logic, please refer to the following documents:

- [Features Tracking](./docs/FEATURES.md)
- [Project Specifications](./docs/SPECS.md)
- [Audio Engine & Interaction Logic](./docs/AUDIO_LOGIC_SPECS.md)
- [Development History](./docs/devhistory.md)

## Tech Stack
- **Frontend**: React 18+, TypeScript, Tailwind CSS
- **State Management**: Zustand (with granular selectors for performance)
- **Audio Engine**: `wavesurfer.js` & `wavesurfer-multitrack` (Canvas-based rendering)
- **Persistence**: `localforage` (IndexedDB)
- **Build Tool**: Vite

## Performance Architecture
Performance is a core priority for AWNN. The application achieves high responsiveness through:
- **Canvas-Based Waveforms**: All audio waveforms are rendered using the HTML5 Canvas API via `wavesurfer.js`, ensuring smooth scrolling and zooming even with multiple tracks.
- **Granular State Selectors**: Using Zustand's selector pattern to prevent unnecessary component re-renders during high-frequency updates (like playhead movement).
- **Timeline Grid Virtualization**: The grid and labels are virtualized to render only the visible portion of the project, maintaining 60fps at any zoom level.
- **Asynchronous Peak Calculation**: Waveform peaks are pre-calculated off the main thread to ensure instantaneous track initialization.
- **Debounced Audio Regeneration**: Metronome and other dynamic audio buffers are generated with debounced logic to prioritize UI responsiveness.

## Getting Started
1. **Install Dependencies**: `npm install`
2. **Start Dev Server**: `npm run dev`
3. **Build for Production**: `npm run build`

