# Future Enhancements

## ✅ Implemented: Live-Scheduled Metronome (feat/metronome-worklet branch)

The AudioWorklet metronome is now implemented. See `docs/devhistory.md` §25 for details and `src/hooks/useAudioEngine.ts` for integration.

## ✅ Implemented: Calibration Test Harness (June 2026)

6 latency tests in an isolated test bed at `tests/calibration-test/`. See `docs/CALIBRATION_TEST.md` for full architecture.

## ✅ Implemented: Feedback Chat System (June 2026)

Long-press feedback chat with SidebarPanel shell, silent polling, cookie persistence, admin reply.

## Still Future: Calibration Production Integration

The test-bed algorithms need to be converted into a unified calibration flow within the production app:
- **Per-device latency profiles** — Store calibration results per device ID in `deviceLatencyCache` (already in `useStore.ts`)
- **Platform-aware test selection** — Clap v2 as primary for Firefox (AEC-proof), MLS/beep for Chrome
- **Auto-run on device change** — Auto-calibrate when a new audio device is detected
- **Visual calibration fallback** — Manual alignment overlay for impossible cases (Bluetooth with aggressive AEC)
- **Confidence scoring** — Combine results from multiple tests into a single confidence-weighted latency estimate

## Still Future: Metronome Enhancements

### 1. Custom click sounds

The worklet already supports `SET_CLICK_SOUNDS` with user-provided `Float32Array` samples. What's missing is the UI:
- Import a WAV file as downbeat and/or offbeat click
- Store in `ClickRenderer` or `MetronomeEngine` state
- Post via `SET_CLICK_SOUNDS` on load

The worklet needs no changes — it already plays whatever samples are posted.

### 2. Per-bar BPM/signature timeline

Replace the single `{ bpm, timeSignature }` message with a timeline array:
```typescript
worklet.port.postMessage({
  type: 'SET_TIMELINE',
  bars: [
    { bar: 1, bpm: 140, beatsPerBar: 4 },
    { bar: 5, bpm: 120, beatsPerBar: 3 },
    { bar: 9, bpm: 160, beatsPerBar: 4 },
  ],
});
```

The worklet would need a new method handler that stores the timeline and switches BPM/sig at the correct bar boundary. Main thread: store timeline in a store field, reuse existing cues UI for editing (snap BPM cues to nearest beat, signature cues to nearest bar).

### 3. BPM changes with existing audio clips

Currently, changing BPM after clips are laid down shows a confirmation modal ("will NOT stretch existing audio clips — grid only"). This is correct for the current grid-only behavior. Future: per-bar BPM timeline means clips snap to the correct bar regardless of tempo at that point. No stretching needed — the clip's `startPosition` in UserTime maps to the correct RealTime via the BPM timeline.

### 3. Visual beat indicator

Currently no visual feedback from the worklet to the UI. Options:
- Worklet posts back a `BEAT` message on each downbeat → main thread flashes a CSS indicator
- Requires adding a `port.postMessage` call in the worklet's `process()` on each downbeat
- Complexity: throttling (every beat = ~500ms at 120BPM, no need to batch)

### 4. Tempo/signature as cues

Cues can carry `{ type: 'bpm', value: 140 }` or `{ type: 'signature', beatsPerBar: 3 }`. Reuse existing cues UI for creation, display, and snapping. Snapping logic: BPM cues snap to nearest beat, signature cues snap to nearest bar.

### 5. Canvas-based grid rendering

**Current:** Bar/beat lines rendered as absolutely-positioned `<div>` elements via React reconciliation. Scroll position updated via CSS `transform` on a ref (no re-render on scroll). Virtualization via `renderTick` state throttled to rAF (~16ms).

**Performance ceiling:** React reconciles visible bar DOM on every virtualization tick. At high zoom levels where many bars are visible, reconciliation overhead grows linearly.

**Canvas approach:** Replace the `<div>` grid with a `<canvas>` element. On scroll + zoom changes, redraw lines via `requestAnimationFrame` + `ctx.beginPath()` + `ctx.moveTo/lineTo/stroke`. Zero DOM nodes, zero React reconciliation. 60fps regardless of bar count.

```typescript
// Sketch:
useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for each visible bar:
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            ctx.fillText(barNumber + '.1', x + 2, 12);
    };
    rafId = requestAnimationFrame(draw);
}, [zoom, scrollLeft, totalBars]);
```

**Trade-off:** Canvas text rendering is less sharp than HTML text at small sizes. Would need a `devicePixelRatio` scaling pass for crisp text. Bar number labels at `9px`/`10px` may need slight size increase. This is purely a visual polish issue, solvable with a 2x resolution canvas pass.
