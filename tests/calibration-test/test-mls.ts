import { biquadBP, findBestShift, computeRMS, peakAmplitude, dot, normalizeCrossCorrelation, peakToNoiseRatio, detectTrailingEdge } from './analysis';

const MLS_SEED = 42;
const MLS_DURATION = 0.5;
const WAKE_CLICKS = 2;
const CLICK_GAP = 0.25;
const MAX_LATENCY_MS = 500;
const PRE_BUF_MS = 50;
const PRE_MLS_GAP_MS = 100;
const MIN_MATCHED = 3;
const MATCH_TOLERANCE_MS = 80;

export interface MlsResult {
  success: boolean;
  latencyMs: number;
  confidence: number;
  stdDev: number;
  matchedBursts: number;
  totalBursts: number;
  outputLatencyMs: number;
  heuristicMs: number;
  error?: string;
  recordedSamples: number;
  inputRms: number;
  inputPeak: number;
  // Edge match data
  detectedEdges: number[];
  expectedEdges: number[];
  matchedExpectedSamples: number[];
  matchedDetectedSamples: number[];
  // Secondary cross-correlation
  p2n: number;
  xcorrLatencyMs: number;
  xcorrConfidence: number;
}

export type MlsAmplitudeMode = 'safe' | 'loud';

export const SAFE_AMPLITUDES = [0.25, 0.375, 0.5];
export const LOUD_AMPLITUDES = [0.5, 0.75, 1.0];
export const DEFAULT_GAPS_MS = [120, 250, 350, 180];

function buildMlsSignal(
  sr: number,
  mlsRef: Float32Array,
  gapMs: number[],
  amplitude: number,
): {
  signal: Float32Array;
  expectedEdgeSamples: number[];
  segmentSampleRanges: { start: number; end: number }[];
} {
  const bufPadSamples = Math.round(PRE_BUF_MS / 1000 * sr);
  const clickSamples = Math.round(0.05 * sr);
  const clickGapSamples = Math.round(CLICK_GAP * sr);
  const preMlsGapSamples = Math.round(PRE_MLS_GAP_MS / 1000 * sr);
  const gapSamples = gapMs.map(g => Math.round(g / 1000 * sr));
  const numSegments = gapSamples.length + 1;
  const segmentLen = Math.floor(mlsRef.length / numSegments);
  const segmentSampleRanges: { start: number; end: number }[] = [];
  const expectedEdgeSamples: number[] = [];

  // Total buffer size: padding + wake clicks + preMlsGap + segments + gaps
  let cursor = bufPadSamples;

  // Wake clicks
  cursor += clickSamples;
  cursor += clickGapSamples;
  cursor += clickSamples;
  cursor += preMlsGapSamples;

  // Segments with gaps between them
  for (let i = 0; i < numSegments; i++) {
    const segStart = cursor;
    cursor += segmentLen;
    segmentSampleRanges.push({ start: segStart, end: cursor });
    // Edge at end of this segment
    expectedEdgeSamples.push(cursor);
    if (i < gapSamples.length) {
      // Add buffer samples before gap
      cursor += gapSamples[i];
    }
  }

  const signal = new Float32Array(cursor);
  // Wake clicks
  cursor = bufPadSamples;
  for (let w = 0; w < WAKE_CLICKS; w++) {
    for (let i = 0; i < clickSamples && cursor + i < signal.length; i++) {
      const t = i / sr;
      signal[cursor + i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 40) * amplitude;
    }
    cursor += clickSamples + (w < WAKE_CLICKS - 1 ? clickGapSamples : preMlsGapSamples);
  }

  // Write MLS segments
  for (let i = 0; i < numSegments; i++) {
    const seg = segmentSampleRanges[i];
    for (let j = seg.start; j < seg.end && j < signal.length; j++) {
      signal[j] = mlsRef[j - seg.start] * amplitude;
    }
  }

  return { signal, expectedEdgeSamples, segmentSampleRanges };
}

function detectTrailingEdgesInRecording(
  signal: Float32Array,
  sr: number,
  noiseFloor: number,
): number[] {
  const hopSamples = Math.round(1 / 1000 * sr);
  const windowSamples = Math.round(5 / 1000 * sr);

  const envelope: number[] = [];
  const times: number[] = [];

  for (let i = 0; i < signal.length - windowSamples; i += hopSamples) {
    let sumSq = 0;
    for (let j = 0; j < windowSamples; j++) {
      const s = signal[i + j];
      sumSq += s * s;
    }
    envelope.push(Math.sqrt(sumSq / windowSamples));
    times.push((i + windowSamples / 2) / sr);
  }

  const maxEnv = Math.max(...envelope);
  const threshold = Math.max(noiseFloor * 4, maxEnv * 0.03);

  const edges: number[] = [];
  const minEdgeGapSamples = Math.round(50 / 1000 * sr / hopSamples);
  let lastEdgeIdx = -minEdgeGapSamples;

  for (let i = 1; i < envelope.length; i++) {
    if (envelope[i - 1] > threshold && envelope[i] <= threshold) {
      if (i - lastEdgeIdx < minEdgeGapSamples) continue;

      const frac = (envelope[i - 1] - threshold) / (envelope[i - 1] - envelope[i]);
      const crossingTime = times[i - 1] + frac * (times[i] - times[i - 1]);
      edges.push(Math.round(crossingTime * sr));
      lastEdgeIdx = i;
    }
  }

  return edges;
}

function extractGapFreeSignal(
  recorded: Float32Array,
  recStartSample: number,
  segmentRanges: { start: number; end: number }[],
  sr: number,
): Float32Array {
  let totalLen = 0;
  for (const seg of segmentRanges) totalLen += seg.end - seg.start;
  const out = new Float32Array(totalLen);
  let outPos = 0;
  for (const seg of segmentRanges) {
    const recStart = recStartSample + seg.start;
    const recEnd = recStart + (seg.end - seg.start);
    for (let i = recStart; i < recEnd && i < recorded.length && outPos < out.length; i++) {
      out[outPos++] = recorded[i];
    }
  }
  return out;
}

export async function runMlsTest(
  ctx: AudioContext,
  workletNode: AudioWorkletNode,
  options?: { amplitude?: number; gapMs?: number[]; bandpass?: boolean },
): Promise<MlsResult> {
  const sr = ctx.sampleRate;
  const outputLatMs = Math.round((ctx.outputLatency || 0) * 1000);
  const heuristicMs = Math.round(2 * (ctx.outputLatency || 0) * 1000);
  const amplitude = options?.amplitude ?? 0.2;
  const gapMs = options?.gapMs ?? DEFAULT_GAPS_MS;
  const useBP = options?.bandpass ?? true;

  const mlsLen = Math.floor(MLS_DURATION * sr);
  const rawMls = generateMLS(MLS_SEED, mlsLen);
  const mlsRef = biquadBP(rawMls, sr, 4000, 0.707);

  const { signal, expectedEdgeSamples, segmentSampleRanges } = buildMlsSignal(sr, mlsRef, gapMs, amplitude);

  const playStartTime = ctx.currentTime + 0.1;
  const startFrame = Math.round(playStartTime * sr);
  const maxLatencySamples = Math.round(MAX_LATENCY_MS / 1000 * sr);
  const recordDuration = signal.length + maxLatencySamples;

  // Reset worklet
  workletNode.port.postMessage({ type: 'RESET' });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 1000);
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'PONG') {
        clearTimeout(timer);
        workletNode.port.removeEventListener('message', handler);
        resolve();
      }
    };
    workletNode.port.addEventListener('message', handler);
    workletNode.port.postMessage({ type: 'PING' });
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({
        success: false, latencyMs: 0, confidence: 0, stdDev: 0,
        matchedBursts: 0, totalBursts: expectedEdgeSamples.length,
        outputLatencyMs: outputLatMs, heuristicMs,
        error: 'Timeout: no response from worklet',
        recordedSamples: -1, inputRms: 0, inputPeak: 0,
        detectedEdges: [], expectedEdges: expectedEdgeSamples,
        matchedExpectedSamples: [], matchedDetectedSamples: [],
        p2n: 0, xcorrLatencyMs: 0, xcorrConfidence: 0,
      });
    }, 15000);

    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'RESULT') {
        const recorded: Float32Array = e.data.frames;
        cleanup();
        clearTimeout(timeout);

        const rms = computeRMS(recorded);
        const peak = peakAmplitude(recorded);
        const diag = {
          recordedSamples: recorded.length,
          inputRms: rms,
          inputPeak: peak,
        };

        if (!recorded || recorded.length < sr / 2) {
          resolve({
            success: false, latencyMs: 0, confidence: 0, stdDev: 0,
            matchedBursts: 0, totalBursts: expectedEdgeSamples.length,
            outputLatencyMs: outputLatMs, heuristicMs,
            error: 'Recording too short',
            detectedEdges: [], expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: [], matchedDetectedSamples: [],
            p2n: 0, xcorrLatencyMs: 0, xcorrConfidence: 0,
            ...diag,
          });
          return;
        }

        const recBP = useBP ? biquadBP(recorded, sr, 4000, 0.707) : recorded;

        // Noise floor from pre-buffer silence (first 50ms of signal)
        const preBufSamples = Math.round(PRE_BUF_MS / 1000 * sr);
        const noiseFloor = computeRMS(recBP.subarray(0, Math.min(preBufSamples, recBP.length)));
        const peakRms = computeRMS(recBP);

        // ─── Primary: trailing-edge detection on gaps ───
        const detectedEdges = detectTrailingEdgesInRecording(recBP, sr, noiseFloor);

        if (detectedEdges.length < MIN_MATCHED) {
          // ─── Secondary: cross-correlation on gap-free segments ───
          const xcorrResult = tryCrossCorrelation(recBP, mlsRef, segmentSampleRanges, sr, startFrame, maxLatencySamples, amplitude);
          if (xcorrResult.usable) {
            resolve({
              success: true, latencyMs: xcorrResult.latencyMs, confidence: xcorrResult.confidence, stdDev: 0,
              matchedBursts: expectedEdgeSamples.length, totalBursts: expectedEdgeSamples.length,
              outputLatencyMs: outputLatMs, heuristicMs,
              detectedEdges: [], expectedEdges: expectedEdgeSamples,
              matchedExpectedSamples: expectedEdgeSamples.map(e => e + xcorrResult.shiftSamples),
              matchedDetectedSamples: expectedEdgeSamples.map(e => e + xcorrResult.shiftSamples),
              p2n: xcorrResult.p2n, xcorrLatencyMs: xcorrResult.latencyMs, xcorrConfidence: xcorrResult.confidence,
              ...diag,
            });
            return;
          }

          resolve({
            success: false, latencyMs: 0, confidence: 0, stdDev: 0,
            matchedBursts: 0, totalBursts: expectedEdgeSamples.length,
            outputLatencyMs: outputLatMs, heuristicMs,
            error: `Only ${detectedEdges.length} trailing edges detected (need ≥${MIN_MATCHED}), cross-correlation P2N ${xcorrResult.p2n.toFixed(1)}dB`,
            detectedEdges, expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: [], matchedDetectedSamples: [],
            p2n: xcorrResult.p2n, xcorrLatencyMs: xcorrResult.latencyMs, xcorrConfidence: xcorrResult.confidence,
            ...diag,
          });
          return;
        }

        const maxShiftSamples = maxLatencySamples;
        const toleranceSamples = Math.round(MATCH_TOLERANCE_MS / 1000 * sr);

        const { matchedDetected, matchedExpected } = findBestShift(
          detectedEdges, expectedEdgeSamples, sr, maxShiftSamples, toleranceSamples,
        );

        if (matchedDetected.length < MIN_MATCHED) {
          // ─── Secondary: cross-correlation ───
          const xcorrResult = tryCrossCorrelation(recBP, mlsRef, segmentSampleRanges, sr, startFrame, maxLatencySamples, amplitude);
          if (xcorrResult.usable) {
            resolve({
              success: true, latencyMs: xcorrResult.latencyMs, confidence: xcorrResult.confidence, stdDev: 0,
              matchedBursts: expectedEdgeSamples.length, totalBursts: expectedEdgeSamples.length,
              outputLatencyMs: outputLatMs, heuristicMs,
              detectedEdges: [], expectedEdges: expectedEdgeSamples,
              matchedExpectedSamples: expectedEdgeSamples.map(e => e + xcorrResult.shiftSamples),
              matchedDetectedSamples: expectedEdgeSamples.map(e => e + xcorrResult.shiftSamples),
              p2n: xcorrResult.p2n, xcorrLatencyMs: xcorrResult.latencyMs, xcorrConfidence: xcorrResult.confidence,
              ...diag,
            });
            return;
          }

          resolve({
            success: false, latencyMs: 0, confidence: 0, stdDev: 0,
            matchedBursts: matchedDetected.length, totalBursts: expectedEdgeSamples.length,
            outputLatencyMs: outputLatMs, heuristicMs,
            error: `Could not match pattern (${matchedDetected.length} matched, need ≥${MIN_MATCHED})`,
            detectedEdges, expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: [], matchedDetectedSamples: [],
            p2n: xcorrResult.p2n, xcorrLatencyMs: xcorrResult.latencyMs, xcorrConfidence: xcorrResult.confidence,
            ...diag,
          });
          return;
        }

        const offsets: number[] = [];
        for (let i = 0; i < matchedDetected.length; i++) {
          offsets.push(matchedDetected[i] - matchedExpected[i]);
        }

        const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
        const variance = offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length;
        const stdDevSamples = Math.sqrt(variance);
        const latencyMs = (mean / sr) * 1000;
        const stdDevMs = (stdDevSamples / sr) * 1000;

        const outliers = offsets.filter(o => Math.abs(o - mean) > toleranceSamples / 2);
        if (outliers.length >= matchedDetected.length / 2) {
          resolve({
            success: false, latencyMs, confidence: 0, stdDev: stdDevMs,
            matchedBursts: matchedDetected.length, totalBursts: expectedEdgeSamples.length,
            outputLatencyMs: outputLatMs, heuristicMs,
            error: `High jitter — too many outliers (${outliers.length}/${matchedDetected.length})`,
            detectedEdges, expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: matchedExpected, matchedDetectedSamples: matchedDetected,
            p2n: 0, xcorrLatencyMs: 0, xcorrConfidence: 0,
            ...diag,
          });
          return;
        }

        const diffFromHeuristic = Math.abs(latencyMs - heuristicMs);
        let confidence = 1 - stdDevMs / (latencyMs + 1);
        if (diffFromHeuristic > 80) confidence *= 0.5;

        const success = stdDevMs < 30 && !(outliers.length >= matchedDetected.length / 2);

        // Cross-correlation for secondary info
        const xcorrResult = tryCrossCorrelation(recBP, mlsRef, segmentSampleRanges, sr, startFrame, maxLatencySamples, amplitude);

        resolve({
          success, latencyMs, confidence, stdDev: stdDevMs,
          matchedBursts: matchedDetected.length, totalBursts: expectedEdgeSamples.length,
          outputLatencyMs: outputLatMs, heuristicMs,
          error: success ? undefined : `StdDev ${stdDevMs.toFixed(1)}ms too high`,
          detectedEdges, expectedEdges: expectedEdgeSamples,
          matchedExpectedSamples: matchedExpected, matchedDetectedSamples: matchedDetected,
          p2n: xcorrResult.p2n, xcorrLatencyMs: xcorrResult.latencyMs, xcorrConfidence: xcorrResult.confidence,
          ...diag,
        });
      }
    };

    const cleanup = () => {
      workletNode.port.removeEventListener('message', onMessage);
    };

    workletNode.port.addEventListener('message', onMessage);

    workletNode.port.postMessage({ type: 'START', startFrame, duration: recordDuration });

    const audioBuffer = ctx.createBuffer(1, signal.length, sr);
    audioBuffer.getChannelData(0).set(signal);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(playStartTime);
  });
}

function tryCrossCorrelation(
  recBP: Float32Array,
  mlsRef: Float32Array,
  segmentSampleRanges: { start: number; end: number }[],
  sr: number,
  startFrame: number,
  maxLatencySamples: number,
  amplitude: number,
): { usable: boolean; p2n: number; latencyMs: number; confidence: number; shiftSamples: number } {
  // Extract gap-free segments from recording
  const gapFree = extractGapFreeSignal(recBP, 0, segmentSampleRanges, sr);
  if (gapFree.length < sr * 0.1) {
    return { usable: false, p2n: 0, latencyMs: 0, confidence: 0, shiftSamples: 0 };
  }

  // Concatenate MLS reference segments (same as signal)
  let refLen = 0;
  for (const seg of segmentSampleRanges) refLen += seg.end - seg.start;
  const refGapFree = new Float32Array(refLen);
  let pos = 0;
  for (const seg of segmentSampleRanges) {
    for (let i = seg.start; i < seg.end && pos < refLen; i++) {
      refGapFree[pos++] = mlsRef[i - seg.start];
    }
  }

  // Cross-correlate gap-free signals
  const mlsStartSample = segmentSampleRanges[0].start;
  const minShift = Math.max(0, mlsStartSample - maxLatencySamples);
  const maxShift = mlsStartSample + maxLatencySamples;

  const { lags, values } = normalizeCrossCorrelation(gapFree, refGapFree, maxShift, minShift);

  if (values.length === 0) {
    return { usable: false, p2n: 0, latencyMs: 0, confidence: 0, shiftSamples: 0 };
  }

  let bestIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[bestIdx]) bestIdx = i;
  }

  const p2nLinear = peakToNoiseRatio(values);
  const p2nDb = 20 * Math.log10(p2nLinear + 1e-10);
  const shiftSamples = lags[bestIdx] - mlsStartSample;
  const latencyMs = (shiftSamples / sr) * 1000;
  const confidence = values[bestIdx];

  return {
    usable: p2nDb >= 15,
    p2n: p2nDb,
    latencyMs,
    confidence,
    shiftSamples,
  };
}

function generateMLS(seed: number, length: number): Float32Array {
  let state = seed & 0x7fff;
  if (state === 0) state = 1;
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buf[i] = (state & 1) ? 1 : -1;
    const feedback = ((state >> 14) ^ (state >> 13)) & 1;
    state = ((state << 1) | feedback) & 0x7fff;
  }
  return buf;
}
