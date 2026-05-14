# Future Enhancements

## ✅ Implemented: Live-Scheduled Metronome (feat/metronome-worklet branch)

The AudioWorklet metronome is now implemented. See `docs/devhistory.md` §25 for details and `src/hooks/useAudioEngine.ts` for integration.

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

### 3. Visual beat indicator

Currently no visual feedback from the worklet to the UI. Options:
- Worklet posts back a `BEAT` message on each downbeat → main thread flashes a CSS indicator
- Requires adding a `port.postMessage` call in the worklet's `process()` on each downbeat
- Complexity: throttling (every beat = ~500ms at 120BPM, no need to batch)

### 4. Tempo/signature as cues

Cues can carry `{ type: 'bpm', value: 140 }` or `{ type: 'signature', beatsPerBar: 3 }`. Reuse existing cues UI for creation, display, and snapping. Snapping logic: BPM cues snap to nearest beat, signature cues snap to nearest bar.
