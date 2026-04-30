# Runtime Performance Optimization Plan
**Goal:** Maximize audio responsiveness and UI smoothness for AWNN app.

## 1. The "Performance Path" Architecture (Critical)

To ensure microsecond-precise timing and 60fps visual synchronization, the application utilizes a "Performance Path" that bypasses React's reconciliation cycle for high-frequency updates.

*   **Direct DOM Manipulation:** High-frequency elements (Playhead, Level Meters, Waveform Cursors) are updated via direct DOM manipulation (`element.style.transform`) inside a `requestAnimationFrame` loop.
*   **Output Latency Compensation:** The visual playhead position is adjusted by `audioContext.outputLatency` to ensure visual-audio synchronization.
*   **React-less Polling:** The main audio engine polling loop (`pollTime`) reads from the imperative `multitrack` instance and updates the DOM directly using `useRef` handles or `id` selectors, rather than triggering React state updates for every frame.
*   **State Decoupling:** The global `currentTime` in the Zustand store is updated at a lower frequency (~10Hz) for UI text displays, while the visual playhead moves at the full display refresh rate (60Hz+).
*   **Imperative Engine Control:** The `useAudioEngine` hook acts as an imperative controller. UI components call methods on the engine instance directly, avoiding the latency of React's declarative state-to-effect pipeline.

## 2. WaveSurfer.js Optimization

*   **Rendering Resolution:** `minPxPerSec` is capped at 100 for multitrack views. High resolution causes canvas lag; lower values improve scroll/zoom speed without perceptible loss for navigation.
*   **Peak Pre-calculation:** Peaks are pre-calculated asynchronously before being passed to WaveSurfer. This avoids main-thread spikes during waveform initialization.
*   **Lazy Initialization:** (Planned) Only initialize WaveSurfer instances for tracks currently in view.
*   **Region Overlays:** Minimizing DOM nodes overlaying the canvas by using optimized React components for markers/regions.

## 3. React & State Management (Zustand + Mutative)

*   **Zustand-Mutative:** Using `mutative` middleware for Zustand to allow for predictable, high-performance state mutations without the overhead of deep object spreading.
*   **Granular Selectors:** Components subscribe only to the specific slices of state they need to minimize re-renders.
*   **Throttled Time Sync:** Audio time synchronization to React state is throttled to ~10Hz (100ms) to reduce React render cycle overhead while maintaining a smooth visual playhead.
*   **Memoization:** Heavy components (like `TimelineGrid` and `EnvelopeEditor`) are optimized to prevent unnecessary re-renders.

## 4. Tailwind & Asset Loading

*   **Zero Runtime Cost:** Tailwind is pre-compiled; no optimization needed at runtime.
*   **Audio Loading:** Uses `URL.createObjectURL()` for local file uploads and recorded blobs to avoid blocking the main thread with data URI conversions.
*   **Async Processing:** Heavy audio math (peak generation, buffer trimming) is offloaded to async functions to keep the UI thread responsive.

## 5. Architecture Confirmation Checklist

*   [x] **No Backend:** App runs 100% client-side.
*   [x] **Static Assets:** All JS/CSS/WASM bundled in `/dist`.
*   [x] **State Isolation:** Zustand selectors are granular.
*   [x] **Canvas Efficiency:** WaveSurfer uses pre-calculated peaks and optimized `minPxPerSec`.
*   [x] **Worker Offloading:** Heavy audio math is offloaded from the immediate UI render path.
*   [x] **Performance Path:** High-frequency visual updates bypass React reconciliation.
