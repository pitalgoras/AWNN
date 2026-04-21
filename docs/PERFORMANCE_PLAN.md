# Runtime Performance Optimization Plan
**Goal:** Maximize audio responsiveness and UI smoothness for AWNN app.

## 1. WaveSurfer.js Optimization (Critical)

*   **Rendering Resolution:** `minPxPerSec` is capped at 100 for multitrack views. High resolution causes canvas lag; lower values improve scroll/zoom speed without perceptible loss for navigation.
*   **Peak Pre-calculation:** Peaks are pre-calculated asynchronously (simulated worker) before being passed to WaveSurfer. This avoids main-thread spikes during waveform initialization.
*   **Lazy Initialization:** (Planned) Only initialize WaveSurfer instances for tracks currently in view.
*   **Region Overlays:** (Ongoing) Minimizing DOM nodes overlaying the canvas by using optimized React components for markers/regions.

## 2. React & State Management (Zustand)

*   **Granular Selectors:** Components now subscribe only to the specific slices of state they need.
    *   **Good:** `const currentTime = useStore(s => s.currentTime)`
    *   **Avoid:** `const { currentTime, tracks } = useStore()` (triggers re-render on *any* store change).
*   **Throttled Time Sync:** Audio time synchronization to React state is throttled to ~10Hz (100ms) to reduce React render cycle overhead while maintaining a smooth visual playhead.
*   **Memoization:** Heavy components (like `TimelineGrid` and `EnvelopeEditor`) are optimized to prevent unnecessary re-renders.

## 3. Tailwind & Asset Loading

*   **Zero Runtime Cost:** Tailwind is pre-compiled; no optimization needed at runtime.
*   **Audio Loading:** Uses `URL.createObjectURL()` for local file uploads and recorded blobs to avoid blocking the main thread with data URI conversions.
*   **Async Processing:** Heavy audio math (peak generation, buffer trimming) is offloaded to async functions to keep the UI thread responsive.

## 4. Architecture Confirmation Checklist

*   [x] **No Backend:** App runs 100% client-side.
*   [x] **Static Assets:** All JS/CSS/WASM bundled in `/dist`.
*   [x] **State Isolation:** Zustand selectors are granular.
*   [x] **Canvas Efficiency:** WaveSurfer uses pre-calculated peaks and optimized `minPxPerSec`.
*   [x] **Worker Offloading:** Heavy audio math is offloaded from the immediate UI render path.

## 5. Song Builder Performance Considerations

### Lyrics Painting & Rendering
- CSS backgrounds for highlighting; debounce drag events; virtualize if needed.

### Alignment Engine
- Off‑main‑thread envelope computation; cache envelopes; O(n) onset detection.

### Publishing
- Opus encoding in Web Worker with progress; sequential file writes.
