import { biquadBP, generateNoise, computeRMS, findBestShift } from './analysis';

const BURST_MS = 30;
const BURST_BUF_MS = 5;
const GAP_PATTERN_MS = [80, 120, 180, 100];
const PRE_BUF_MS = 50;
const POST_BUF_MS = 100;
const DEFAULT_AMPLITUDE = 0.4;
const MAX_LATENCY_MS = 500;
const MIN_MATCHED = 3;
const MATCH_TOLERANCE_MS = 80;

export interface EarlyBeepResult {
  success: boolean;
  latencyMs: number;
  confidence: number;
  stdDev: number;
  matchedBursts: number;
  totalBursts: number;
  noiseFloorRms: number;
  peakRms: number;
  error?: string;
  detectedEdges: number[];
  expectedEdges: number[];
  matchedExpectedSamples: number[];
  matchedDetectedSamples: number[];
}

function generateEarlyBeepSignal(sr: number, amplitude: number): {
  signal: Float32Array;
  expectedEdgeSamples: number[];
  totalSamples: number;
} {
  const burstSamples = Math.round(BURST_MS / 1000 * sr);
  const burstBufSamples = Math.round(BURST_BUF_MS / 1000 * sr);
  const preBufSamples = Math.round(PRE_BUF_MS / 1000 * sr);
  const postBufSamples = Math.round(POST_BUF_MS / 1000 * sr);
  const gapSamples = GAP_PATTERN_MS.map(g => Math.round(g / 1000 * sr));

  const noise = generateNoise(42, burstSamples, amplitude);
  const bpNoise = biquadBP(noise, sr, 4000, 0.707);

  const numBursts = gapSamples.length + 1;
  const expectedEdgeSamples: number[] = [];
  let cursor = preBufSamples;

  for (let i = 0; i < numBursts; i++) {
    cursor += burstBufSamples;
    cursor += burstSamples;
    expectedEdgeSamples.push(cursor);
    cursor += burstBufSamples;
    if (i < gapSamples.length) cursor += gapSamples[i];
  }

  const totalSamples = cursor + postBufSamples;
  const signal = new Float32Array(totalSamples);
  cursor = preBufSamples;

  for (let i = 0; i < numBursts; i++) {
    cursor += burstBufSamples;
    for (let j = 0; j < burstSamples && cursor + j < totalSamples; j++) {
      signal[cursor + j] = bpNoise[j];
    }
    cursor += burstSamples;
    cursor += burstBufSamples;
    if (i < gapSamples.length) cursor += gapSamples[i];
  }

  return { signal, expectedEdgeSamples, totalSamples };
}

function detectTrailingEdges(signal: Float32Array, sr: number, noiseFloor: number): number[] {
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

export async function runEarlyBeepTest(
  ctx: AudioContext,
  workletNode: AudioWorkletNode,
  amplitude?: number,
): Promise<EarlyBeepResult> {
  const amp = amplitude ?? DEFAULT_AMPLITUDE;
  const sr = ctx.sampleRate;
  const heuristicMs = Math.round(2 * (ctx.outputLatency || 0) * 1000);

  const { signal, expectedEdgeSamples, totalSamples } = generateEarlyBeepSignal(sr, amp);

  const playStartTime = ctx.currentTime + 0.05;
  const startFrame = Math.round(playStartTime * sr);
  const maxLatencySamples = Math.round(MAX_LATENCY_MS / 1000 * sr);
  const recordDuration = totalSamples + maxLatencySamples;

  workletNode.port.postMessage({ type: 'RESET' });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 500);
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
        noiseFloorRms: 0, peakRms: 0, error: 'Timeout: no response from worklet',
        detectedEdges: [], expectedEdges: expectedEdgeSamples,
        matchedExpectedSamples: [], matchedDetectedSamples: [],
      });
    }, 10000);

    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'RESULT') {
        const recorded: Float32Array = e.data.frames;
        cleanup();
        clearTimeout(timeout);

        if (!recorded || recorded.length < sr / 2) {
          resolve({
            success: false, latencyMs: 0, confidence: 0, stdDev: 0,
            matchedBursts: 0, totalBursts: expectedEdgeSamples.length,
            noiseFloorRms: 0, peakRms: 0, error: 'Recording too short',
            detectedEdges: [], expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: [], matchedDetectedSamples: [],
          });
          return;
        }

        const recBP = biquadBP(recorded, sr, 4000, 0.707);
        const preBufSamples = Math.round(PRE_BUF_MS / 1000 * sr);
        const noiseFloor = computeRMS(recBP.subarray(0, Math.min(preBufSamples, recBP.length)));
        const peakRms = computeRMS(recBP);
        const detectedEdges = detectTrailingEdges(recBP, sr, noiseFloor);

        if (detectedEdges.length < MIN_MATCHED) {
          resolve({
            success: false, latencyMs: 0, confidence: 0, stdDev: 0,
            matchedBursts: 0, totalBursts: expectedEdgeSamples.length,
            noiseFloorRms: noiseFloor, peakRms,
            error: `Only ${detectedEdges.length} trailing edges detected, need ≥${MIN_MATCHED}`,
            detectedEdges, expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: [], matchedDetectedSamples: [],
          });
          return;
        }

        const maxShiftSamples = maxLatencySamples;
        const toleranceSamples = Math.round(MATCH_TOLERANCE_MS / 1000 * sr);

        const { matchedDetected, matchedExpected } = findBestShift(
          detectedEdges, expectedEdgeSamples, sr, maxShiftSamples, toleranceSamples,
        );

        if (matchedDetected.length < MIN_MATCHED) {
          resolve({
            success: false, latencyMs: 0, confidence: 0, stdDev: 0,
            matchedBursts: matchedDetected.length, totalBursts: expectedEdgeSamples.length,
            noiseFloorRms: noiseFloor, peakRms,
            error: `Could not match pattern (${matchedDetected.length} matched, need ≥${MIN_MATCHED})`,
            detectedEdges, expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: [], matchedDetectedSamples: [],
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
            noiseFloorRms: noiseFloor, peakRms,
            error: `High jitter — too many outliers (${outliers.length}/${matchedDetected.length})`,
            detectedEdges, expectedEdges: expectedEdgeSamples,
            matchedExpectedSamples: matchedExpected, matchedDetectedSamples: matchedDetected,
          });
          return;
        }

        const diffFromHeuristic = Math.abs(latencyMs - heuristicMs);
        let confidence = 1 - stdDevMs / (latencyMs + 1);
        if (diffFromHeuristic > 80) confidence *= 0.5;

        const success = stdDevMs < 30 && !(outliers.length >= matchedDetected.length / 2);

        resolve({
          success, latencyMs, confidence, stdDev: stdDevMs,
          matchedBursts: matchedDetected.length, totalBursts: expectedEdgeSamples.length,
          noiseFloorRms: noiseFloor, peakRms,
          error: success ? undefined : `StdDev ${stdDevMs.toFixed(1)}ms too high, diff from heuristic ${diffFromHeuristic.toFixed(0)}ms`,
          detectedEdges, expectedEdges: expectedEdgeSamples,
          matchedExpectedSamples: matchedExpected, matchedDetectedSamples: matchedDetected,
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
