# Ringbuf.js — Future Feature Consideration

## What It Is

[ringbuf.js](https://github.com/padenot/ringbuf.js) by Paul Adenot (Mozilla) is a **wait-free Single-Producer Single-Consumer (SPSC) ring buffer** for the Web, built on `SharedArrayBuffer`. It enables lock-free, allocation-free data streaming between an `AudioWorklet` thread and the main thread (or a Worker).

### Components
- `ringbuf.ts` — low-level SPSC ring buffer (integer/float values)
- `audioqueue.ts` — wrapper for streaming interleaved Float32 audio
- `param.ts` — wrapper for parameter changes (index + value pairs)

All three avoid `postMessage` entirely for the data path — instead, threads share memory via `SharedArrayBuffer` and communicate through atomic operations.

---

## How It Would Replace Our Current Approach

### Current: `recorder.worklet.js`

```
process() every 128 samples:
  new Float32Array(128)            ← allocation #1
  .set(channelData)                ← fill
  push({data, frame})              ← grow rolling buffer array

STOP_RECORDING:
  _flush():
    iterate all chunks
    new Float32Array(totalLength)  ← allocation #2 (concatenation)
    .set() each chunk into result
    _rollingBuffer = []
  postMessage({audioData, ...})    ← transfer result (zero-copy)
```

### With ringbuf.js

```
process() every 128 samples:
  write(channelData)               ← write into SAB (no allocation, no copy)
  increment write index            ← atomic store

STOP_RECORDING:
  calculate start/end positions    ← pointer arithmetic on SAB
  postMessage({startFrame, endFrame})  ← lightweight control message

Main thread:
  reads directly from SAB          ← no copy, no concatenation
  pre-roll = read(startFrame - headLength → startFrame)
  recording = read(startFrame → endFrame)
```

No `Float32Array` allocations during recording. No concatenation on stop. The main thread has immediate access to the data.

---

## Pros

| Benefit | Impact |
|---------|--------|
| **Zero allocations on audio thread** | No GC pauses during recording — fully deterministic timing |
| **No concatenation on stop** | `_flush()` becomes pointer math — sub-millisecond stop |
| **Real-time monitoring** | Main thread can read the ring buffer during recording for live waveform, VU, clipping detection |
| **Simpler pre-roll extraction** | Head window is just a different offset into the SAB — no chunk iteration |
| **True streaming** | Could stream audio to a Worker for WebCodecs encode without touching the main thread |

---

## Cons

| Cost | Impact |
|------|--------|
| **COOP/COEP required** | Server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. All CDN-hosted resources must send `Cross-Origin-Resource-Policy: cross-origin` or CORS headers. |
| **Safari compatibility** | SharedArrayBuffer requires Safari ≥15.2 but with a special env flag for Safari ≤16.4 (`__XPC_JSC_useSharedArrayBuffer=1`). Not available on Safari iOS <16.4. |
| **Vercel deployment friction** | Need `vercel.json` with security headers. Must audit ALL resources (fonts, images, scripts) for COEP compliance. A single missing CORP header breaks the entire page. |
| **Dev environment config** | Vite dev server needs custom headers for SAB. |
| **More complex architecture** | Ring buffer introduces read/write pointers, wrap-around handling, atomic fences. Harder to debug than a simple array. |
| **Existing code already works** | The current approach is simple, well-understood, and works on all browsers without headers. The 97% allocation reduction (via accumulator buffer) already mitigates the main GC concern. |

---

## When to Revisit

ringbuf.js becomes valuable when any of these are needed:

1. **Live waveform preview during recording** — main thread reads the ring buffer in real-time to show mic input waveform as the user records
2. **WebCodecs integration** — stream PCM from worklet directly to a WebCodecs Worker for parallel encoding
3. **GC-related glitches observed** — if the accumulator buffer (current approach) proves insufficient and GC pauses degrade recording quality
4. **Multi-worklet synchronization** — sharing timing or audio data between recorder, metronome, and playback worklets

---

## Decision

**Deferred.** The accumulator buffer approach (`docs/devhistory.md` section 37) addresses the allocation concern at 97% reduction with zero architectural change. If real-time waveform or WebCodecs become requirements, ringbuf.js should be re-evaluated — the COOP/COEP deployment cost becomes justifiable when the feature set demands it.
