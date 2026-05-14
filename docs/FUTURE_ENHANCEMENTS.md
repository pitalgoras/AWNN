# Future Enhancements

## Live-Scheduled Metronome (replace pre-rendered WAV)

### Motivation

Current approach:
- Pre-renders a 600s WAV of click sounds (`generateClickTrackBuffer`)
- Converts to WAV blob format (`audioBufferToWav`)
- Creates a blob URL → feeds to WaveSurfer as a track
- BPM/signature change → re-encode entire 600s buffer → full multitrack rebuild

Problems:
- ~50MB memory for the WAV blob (600s × 44100 × 2 bytes)
- Slow BPM changes (re-encoding 26M samples)
- No per-bar BPM/signature support (bars are assumed uniform)
- Hard to support custom click sounds without re-encoding
- The metronome track competes for resources with real audio tracks

### Proposed: AudioWorklet click scheduler

A dedicated `metronome.worklet.js` that generates click samples live on each `process()` call, synchronized to the AudioContext hardware clock.

**Architecture:**

```
Store { bpm, timeSignature, metronomeEnabled, metronomeTrackVisible, barLinesEnabled }
        │
        ▼
Main Thread ──postMessage({ bpm, timeSignature })──► AudioWorklet
                                                          │
        ▲                                          process() loop
        │                                          computes current beat
        │                                          generates click samples
        │                                          into output buffer
        │
  Scheduler state:
  { frame: 0, framesPerBeat: N, nextBeatTime: T }
```

**Zero drift guarantee:**

The worklet's `currentFrame` derives from the AudioContext hardware clock. Every `process()` call computes:
```
beatIndex = floor(currentFrame / framesPerBeat)
beatInBar = beatIndex % beatsPerBar
isDownbeat = beatInBar === 0
```

Tempo change: update `framesPerBeat` in the worklet. The next beat lands at the correct frame automatically ±1 sample (±0.02ms at 44.1kHz).

**No WAV encoding, no blob URL, no WaveSurfer track.**

### Connection to metronome toggle settings

```
metronomeEnabled = false
  → Worklet bypasses: output silent frames
  → barLinesEnabled forced false, metronomeTrackVisible forced false
  → UI: no metronome audio, no bar/beat lines, no metronome track

barLinesEnabled = false
  → TimelineGrid: hidden (already implemented)
  → Worklet unaffected

metronomeTrackVisible = false
  → No visual track in multitrack (already implemented via skip in multitrackItems)
  → Worklet unaffected
```

### Custom click sounds

Instead of hardcoding sine burst math in the worklet, accept two pre-loaded `AudioBuffer` objects (downbeat, offbeat) from the main thread:
```typescript
worklet.port.postMessage({
  type: 'SET_CLICK_SOUNDS',
  downbeat: downbeatBuffer.getChannelData(0),
  offbeat: offbeatBuffer.getChannelData(0),
  sampleRate: ctx.sampleRate,
});
```

The worklet copies these sample arrays into the output at the correct beat positions. Users can provide any WAV file as the click sound.

### Per-bar BPM/signature changes

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

The worklet tracks which bar it's in and switches BPM/beatsPerBar at bar boundaries — no rescheduling, no gap, no drift. The main thread updates the timeline via `postMessage`, which is sample-synchronous in AudioWorklet.

### Memory comparison

| Aspect | Current (pre-rendered WAV) | Proposed (AudioWorklet) |
|--------|---------------------------|------------------------|
| Metronome audio | ~50MB WAV blob | ~2KB (2 click envelope arrays) |
| BPM change | 50MB re-encode ~500ms | Instant (update `framesPerBeat`) |
| Custom sounds | Requires full re-encode | Swap 2 AudioBuffer references |
| Per-bar changes | Impossible | Built-in via timeline array |
| WaveSurfer track | Yes, full waveform render | None (or visual-only CSS strip) |
| Scheduler drift | N/A (plays as track) | Zero (±1 sample, hardware clock) |

### Implementation sketch

**1. Create `public/worklets/metronome.worklet.js`**

```js
class MetronomeWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesPerBeat = 0; // samples per beat at current BPM
    this.beatsPerBar = 4;
    this.sampleRate = 44100;
    this.enabled = false;
    this.downbeatSamples = null;
    this.offbeatSamples = null;

    this.port.onmessage = (e) => {
      const { type, ...data } = e.data;
      switch (type) {
        case 'CONFIGURE':
          this.framesPerBeat = Math.round(this.sampleRate * 60 / data.bpm);
          this.beatsPerBar = data.beatsPerBar || 4;
          this.enabled = data.enabled !== false;
          break;
        case 'SET_SAMPLE_RATE':
          this.sampleRate = data.sampleRate;
          break;
        case 'SET_CLICK_SOUNDS':
          this.downbeatSamples = data.downbeat;
          this.offbeatSamples = data.offbeat;
          break;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.enabled || this.framesPerBeat === 0) return true;
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const channel = output[0];
    for (let i = 0; i < channel.length; i++) {
      const frame = currentFrame + i;
      const beatFrame = frame % this.framesPerBeat;
      if (beatFrame === 0) {
        const beatIndex = Math.floor(frame / this.framesPerBeat);
        const isDownbeat = (beatIndex % this.beatsPerBar) === 0;
        const click = isDownbeat ? this.downbeatSamples : this.offbeatSamples;
        if (click) {
          // Copy click samples into output at this offset
          for (let j = 0; j < click.length && i + j < channel.length; j++) {
            channel[i + j] += click[j];
          }
        }
      }
    }
    currentFrame += channel.length;
    return true;
  }
}

let currentFrame = 0;
registerProcessor('metronome-processor', MetronomeWorklet);
```

**2. Create `src/audio/metronome/MetronomeScheduler.ts`**

Manages the worklet lifecycle:
- Loads `metronome.worklet.js` via `audioContext.audioWorklet.addModule()`
- Creates `AudioWorkletNode` connected to `audioContext.destination`
- Posts `CONFIGURE` messages on BPM/signature/metronomeEnabled changes
- Loads user-provided click sounds and posts `SET_CLICK_SOUNDS`

**3. Integrate into `useAudioEngine.ts`**

Replace the current `MetronomeEngine` buffer-based approach:
- Remove `generateClickTrackBuffer()` and `audioBufferToWav()` calls
- Route click audio through `MetronomeScheduler` worklet node
- Keep the `metronomeTrackVisible` toggle for the visual track (the worklet handles audio independently)
- Keep `barLinesEnabled` for TimelineGrid (unchanged)

### Open questions

1. **Visual click indicator on timeline** — should the timeline flash/show beat markers that sync with the worklet's generated clicks? This would require a `postMessage` back from the worklet on each beat, adding complexity.

2. **Pre-roll bar with worklet** — the current system delays the start position by 1 bar and creates a pre-roll region. With a worklet, the pre-roll bar just means not generating clicks until the main timeline position crosses bar 1.1.

3. **Custom click sound UI** — where in the UI would users import custom click WAVs? Current Settings modal? Drag & drop onto the metronome section?

4. **WaveSurfer sync** — if the metronome track is removed, the WaveSurfer timeline plugin handles bar/beat lines and labels. The worklet doesn't need to communicate with WaveSurfer.
