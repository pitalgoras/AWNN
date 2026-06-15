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

## 6. AudioWorklet Allocation Reduction

### Problem
Each `process()` call in `recorder.worklet.js` (every 128 samples, ~344 times/s) previously allocated a new `Float32Array(128)` and pushed individual chunks to the rolling buffer. This caused ~344 allocations/s on the audio thread, generating GC pressure that could introduce jitter in recording timing.

### Solution (June 2026)
- Pre-allocate a single `Float32Array(4096)` accumulator in the AudioWorklet constructor
- All `process()` calls copy input into this fixed buffer (zero allocations)
- Every ~93ms (when accumulator is full), `_pushAccumulator()` `.slice()`-s the buffer and pushes to `_rollingBuffer`
- On stop, `_pushAccumulator()` flushes the remaining partial chunk before `_flush()`

### Impact
| Metric | Before | After |
|--------|--------|-------|
| Allocations/s in process() | ~344 | ~11 |
| Push operations/s | ~344 | ~11 |
| Architectural change | None (transparent to caller) |
| Ringbuf.js needed? | No — 97% reduction already mitigates GC concern |

### Trade-offs
- **~93ms additional stop latency**: The accumulator holds up to 4095 unwritten samples. `_pushAccumulator()` flushes synchronously before `_flush()` — negligible on the audio thread (~1 process call of work).
- **Rolling buffer extends ~93ms beyond 2s limit**: During pre-roll, untrimmed data in accumulator can exceed the nominal rolling buffer duration. Head margin (max 1s) absorbs this easily.
- **Two bugs fixed post-implementation**: Write index was `0` instead of `this._accPos` (always overwrote position 0); `_accPos` increment used `=` instead of `+=` (never grew past 128). Both fixed in commits `e170b8a`/`3cf1c99`. See `docs/devhistory.md` section 38 for details.
