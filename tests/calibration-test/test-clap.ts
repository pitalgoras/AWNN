import { computeRMS, findBestShift, biquadHP } from './analysis';

const FADE_SAMPLES = 0.002;
const CLICK_FREQ = 1000;
const CLICK_FADE_RATE = 100;
const RMS_WINDOW = 0.005;
const RMS_HOP = 0.001;
const CLAP_MIN_GAP = 0.05;
const CLAP_MAX_DIST = 0.12;
const MIN_CLAPS = 3;
const MAX_LATENCY_MS = 500;
const CLICK_EXCLUDE_WINDOW = 0.04;

export interface ClapChunk {
  idx: number;
  latencyMs: number;
  confidence: number;
  stdDev: number;
  clapPositionsMs: number[];
  beatPositionsMs: number[];
  matchedClaps: number;
  totalBeats: number;
  peakRms: number;
}

export interface ClapTestResult {
  success: boolean;
  latencyMs: number;
  confidence: number;
  stdDev: number;
  matchedClaps: number;
  totalBeats: number;
  chunks: ClapChunk[];
  chunksUsed: number;
  error?: string;
}

/**
 * Generate a looping rhythmic pattern: N steady beats + half-beat-early anchor on last beat.
 * Returns the full pattern buffer (NOT looped — caller uses BufferSourceNode.loop = true).
 */
function generateLoopPattern(sr: number, bpm: number, beatsPerLoop: number, amplitude: number): Float32Array {
  const beatFrames = Math.round(60 / bpm * sr);
  const clickFrames = Math.round(0.01 * sr);
  const fadeLen = Math.min(Math.round(FADE_SAMPLES * sr), clickFrames >> 2);
  const anchorGapFrames = Math.round(beatFrames * 0.5);
  const totalFrames = (beatsPerLoop - 1) * beatFrames + anchorGapFrames;

  const buf = new Float32Array(totalFrames);
  for (let i = 0; i < beatsPerLoop - 1; i++) {
    const pos = i * beatFrames;
    for (let j = 0; j < clickFrames && pos + j < totalFrames; j++) {
      const t = j / sr;
      let env = Math.exp(-t * CLICK_FADE_RATE);
      if (j < fadeLen) env = (j / fadeLen) * env;
      if (j >= clickFrames - fadeLen) env = ((clickFrames - 1 - j) / fadeLen) * env;
      buf[pos + j] = Math.sin(2 * Math.PI * CLICK_FREQ * t) * env * amplitude;
    }
  }
  const lastPos = (beatsPerLoop - 1) * beatFrames - anchorGapFrames;
  for (let j = 0; j < clickFrames && lastPos + j < totalFrames; j++) {
    const t = j / sr;
    let env = Math.exp(-t * CLICK_FADE_RATE);
    if (j < fadeLen) env = (j / fadeLen) * env;
    if (j >= clickFrames - fadeLen) env = ((clickFrames - 1 - j) / fadeLen) * env;
    buf[lastPos + j] = Math.sin(2 * Math.PI * CLICK_FREQ * t) * env * amplitude;
  }
  return buf;
}

function detectClapPeaks(
  signal: Float32Array,
  sr: number,
  clickPositions: number[],
): number[] {
  const hop = Math.round(RMS_HOP * sr);
  const win = Math.round(RMS_WINDOW * sr);
  const envelope: number[] = [];
  const times: number[] = [];

  for (let i = 0; i < signal.length - win; i += hop) {
    let sumSq = 0;
    for (let j = 0; j < win; j++) sumSq += signal[i + j] * signal[i + j];
    envelope.push(Math.sqrt(sumSq / win));
    times.push((i + win / 2) / sr);
  }

  const envMax = Math.max(...envelope);
  const noiseEst = computeRMS(signal);
  const threshold = Math.max(noiseEst * 5, envMax * 0.1);
  const minGapSamples = Math.round(CLAP_MIN_GAP * sr / hop);

  const rawPeaks: number[] = [];
  let lastIdx = -minGapSamples;
  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1]) {
      if (i - lastIdx >= minGapSamples) {
        rawPeaks.push(Math.round(times[i] * sr));
        lastIdx = i;
      }
    }
  }

  const clickExcludeSamples = Math.round(CLICK_EXCLUDE_WINDOW * sr);
  const peaks: number[] = [];
  for (const p of rawPeaks) {
    let isClick = false;
    for (const cp of clickPositions) {
      if (Math.abs(p - cp) < clickExcludeSamples) { isClick = true; break; }
    }
    if (!isClick) peaks.push(p);
  }

  return peaks;
}

function analyzeChunk(
  recorded: Float32Array,
  expectedBeatSamples: number[],
  sr: number,
  heuristicMs: number,
): ClapChunk | null {
  if (recorded.length < sr * 0.1) return null;

  const clickPositions = expectedBeatSamples.filter(s => s >= 0 && s < recorded.length);
  const clapPeaks = detectClapPeaks(recorded, sr, clickPositions);
  const beatPositions = [...Array(clickPositions.length).keys()].map(i =>
    Math.round(i * 60 / 120 * sr)
  );

  if (clapPeaks.length < MIN_CLAPS) return null;

  const maxShiftSamples = Math.round(MAX_LATENCY_MS / 1000 * sr);
  const toleranceSamples = Math.round(CLAP_MAX_DIST * sr);

  const { matchedDetected, matchedExpected } = findBestShift(
    clapPeaks, clickPositions, sr, maxShiftSamples, toleranceSamples,
  );

  if (matchedDetected.length < MIN_CLAPS) return null;

  const offsets: number[] = [];
  for (let i = 0; i < matchedDetected.length; i++) {
    offsets.push(matchedDetected[i] - matchedExpected[i]);
  }

  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length;
  const stdDevSamples = Math.sqrt(variance);
  const latencyMs = (mean / sr) * 1000;
  const stdDevMs = (stdDevSamples / sr) * 1000;

  const diffFromHeuristic = Math.abs(latencyMs - heuristicMs);
  let confidence = 1 - stdDevMs / (latencyMs + 1);
  if (diffFromHeuristic > 80) confidence *= 0.5;

  return {
    idx: 0,
    latencyMs,
    confidence: Math.max(0, Math.min(1, confidence)),
    stdDev: stdDevMs,
    clapPositionsMs: matchedDetected.map(s => s / sr * 1000),
    beatPositionsMs: clickPositions.map(s => s / sr * 1000),
    matchedClaps: matchedDetected.length,
    totalBeats: clickPositions.length,
    peakRms: computeRMS(recorded),
  };
}

export async function runClapTest(
  ctx: AudioContext,
  workletNodes: [AudioWorkletNode, AudioWorkletNode],
  options: {
    bpm: number;
    chunkSizeSec: number;
    gapMs: number;
    amplitude?: number;
    beatsPerLoop?: number;
  },
  onProgress?: (chunk: ClapChunk) => void,
  signal?: AbortSignal,
): Promise<ClapTestResult> {
  const sr = ctx.sampleRate;
  const bpm = options.bpm;
  const chunkSize = Math.round(options.chunkSizeSec * sr);
  const gapSamples = Math.round(options.gapMs / 1000 * sr);
  const amplitude = options.amplitude ?? 0.3;
  const beatsPerLoop = options.beatsPerLoop ?? 8;
  const heuristicMs = Math.round(2 * (ctx.outputLatency || 0) * 1000);

  const patternFrames = Math.round((beatsPerLoop - 1) * 60 / bpm * sr) + Math.round(0.5 * 60 / bpm * sr);
  const pattern = generateLoopPattern(sr, bpm, beatsPerLoop, amplitude);

  const playStartTime = ctx.currentTime + 0.2;
  const playStartFrame = Math.round(playStartTime * sr);

  const audioBuffer = ctx.createBuffer(1, patternFrames, sr);
  audioBuffer.getChannelData(0).set(pattern);
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.loop = true;
  const gainNode = ctx.createGain();
  gainNode.gain.value = amplitude;
  src.connect(gainNode);
  gainNode.connect(ctx.destination);
  src.start(playStartTime);

  const chunks: ClapChunk[] = [];
  let chunkIdx = 0;
  let recordingStart = playStartFrame;

  const [wa, wb] = workletNodes;
  let activeNode: AudioWorkletNode = wa;

  try {
    while (!signal?.aborted) {
      const currentStart = recordingStart;
      const result = await new Promise<Float32Array>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('chunk timeout')), options.chunkSizeSec * 1000 + 3000);
        const handler = (e: MessageEvent) => {
          if (e.data.type === 'RESULT') {
            clearTimeout(timeout);
            activeNode.port.removeEventListener('message', handler);
            resolve(e.data.frames);
          }
        };
        activeNode.port.addEventListener('message', handler);
        activeNode.port.postMessage({ type: 'RESET' });
        activeNode.port.postMessage({ type: 'START', startFrame: currentStart, duration: chunkSize });
      });

      const loopIndex = Math.floor((currentStart - playStartFrame) / patternFrames);
      const offsetInLoop = (currentStart - playStartFrame) - loopIndex * patternFrames;
      const expectedBeatSamples: number[] = [];
      const beatFrames = Math.round(60 / bpm * sr);
      for (let b = 0; b < beatsPerLoop; b++) {
        let pos: number;
        if (b < beatsPerLoop - 1) {
          pos = offsetInLoop + b * beatFrames;
        } else {
          pos = offsetInLoop + (b - 1) * beatFrames + Math.round(beatFrames * 0.5);
        }
        if (pos >= 0 && pos < chunkSize) expectedBeatSamples.push(pos);
      }

      const analyzed = analyzeChunk(result, expectedBeatSamples, sr, heuristicMs);
      if (analyzed) {
        analyzed.idx = chunkIdx;
        chunks.push(analyzed);
        onProgress?.(analyzed);
      }

      chunkIdx++;
      recordingStart += chunkSize;

      if (!signal?.aborted) {
        const gapEnd = await new Promise<void>(resolve => setTimeout(() => resolve(), options.gapMs));
        recordingStart += Math.round(gapSamples);
        activeNode = activeNode === wa ? wb : wa;
      }
    }
  } finally {
    src.stop();
    gainNode.disconnect();
    src.disconnect();
  }

  if (chunks.length === 0) {
    return { success: false, latencyMs: 0, confidence: 0, stdDev: 0, matchedClaps: 0, totalBeats: 0, chunks: [], chunksUsed: 0, error: 'No valid chunks' };
  }

  const validChunks = chunks.filter(c => c.confidence > 0.3 && c.matchedClaps >= MIN_CLAPS);
  if (validChunks.length === 0) {
    const best = chunks.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return { success: false, latencyMs: best.latencyMs, confidence: 0, stdDev: best.stdDev, matchedClaps: best.matchedClaps, totalBeats: best.totalBeats, chunks, chunksUsed: 0, error: 'No chunk reached confidence threshold' };
  }

  const latencyValues = validChunks.map(c => c.latencyMs);
  const meanLat = latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length;
  const variance = latencyValues.reduce((a, b) => a + (b - meanLat) ** 2, 0) / latencyValues.length;
  const stdMs = Math.sqrt(variance);
  const weightedConfidence = validChunks.reduce((sum, c) => sum + c.confidence, 0) / validChunks.length;
  const totalMatched = validChunks.reduce((sum, c) => sum + c.matchedClaps, 0);
  const totalBeats = validChunks.reduce((sum, c) => sum + c.totalBeats, 0);

  const success = validChunks.length >= 2 && stdMs < 30 && totalMatched >= MIN_CLAPS;

  return {
    success,
    latencyMs: meanLat,
    confidence: weightedConfidence,
    stdDev: stdMs,
    matchedClaps: totalMatched,
    totalBeats,
    chunks,
    chunksUsed: validChunks.length,
    error: success ? undefined : `Only ${validChunks.length} valid chunks, stdDev ${stdMs.toFixed(1)}ms`,
  };
}
