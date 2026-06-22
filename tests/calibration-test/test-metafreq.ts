import { biquadBP, computeRMS } from './analysis';

const BURST_MS = 50;
const BURST_BUF_MS = 10;
const GAP_PATTERN_MS = [200, 350, 500, 300];
const PRE_BUF_MS = 100;
const POST_BUF_MS = 100;
const AMPLITUDE = 0.5;
const MAX_LATENCY_MS = 500;
const MIN_FREQ = 127;
const MAX_FREQ = 10000;
const STEPS_PER_OCTAVE = 4;

export interface MetaFreqPoint {
  frequencyHz: number;
  amplitudeRms: number;
  amplitudeDb: number;
  noiseFloorRms: number;
}

export interface MetaFreqResult {
  success: boolean;
  points: MetaFreqPoint[];
  peakFrequencyHz: number;
  peakAmplitudeDb: number;
  error?: string;
}

function generateFreqBeepSignal(sr: number, freqHz: number): {
  signal: Float32Array;
  sampleRanges: { start: number; end: number }[];
} {
  const burstSamples = Math.round(BURST_MS / 1000 * sr);
  const burstBufSamples = Math.round(BURST_BUF_MS / 1000 * sr);
  const preBufSamples = Math.round(PRE_BUF_MS / 1000 * sr);
  const postBufSamples = Math.round(POST_BUF_MS / 1000 * sr);
  const gapSamples = GAP_PATTERN_MS.map(g => Math.round(g / 1000 * sr));

  const fadeLen = Math.min(Math.round(2 / 1000 * sr), burstSamples >> 2);
  const burst = new Float32Array(burstSamples);
  for (let i = 0; i < burstSamples; i++) {
    const t = i / sr;
    let env = 1;
    if (i < fadeLen) env = i / fadeLen;
    if (i >= burstSamples - fadeLen) env = (burstSamples - 1 - i) / fadeLen;
    burst[i] = (Math.sin(2 * Math.PI * freqHz * t) >= 0 ? AMPLITUDE : -AMPLITUDE) * env;
  }

  const numBursts = gapSamples.length + 1;
  const sampleRanges: { start: number; end: number }[] = [];
  let cursor = preBufSamples;

  for (let i = 0; i < numBursts; i++) {
    cursor += burstBufSamples;
    const burstStart = cursor;
    cursor += burstSamples;
    sampleRanges.push({ start: burstStart, end: cursor });
    cursor += burstBufSamples;
    if (i < gapSamples.length) cursor += gapSamples[i];
  }

  const totalSamples = cursor + postBufSamples;
  const signal = new Float32Array(totalSamples);
  cursor = preBufSamples;

  for (let i = 0; i < numBursts; i++) {
    cursor += burstBufSamples;
    for (let j = 0; j < burstSamples && cursor + j < totalSamples; j++) {
      signal[cursor + j] = burst[j];
    }
    const srStart = sampleRanges[i].start;
    cursor = sampleRanges[i].end;
    cursor += burstBufSamples;
    if (i < gapSamples.length) cursor += gapSamples[i];
  }

  return { signal, sampleRanges };
}

function measureFreqAmplitude(
  recorded: Float32Array,
  sampleRanges: { start: number; end: number }[],
  sr: number,
  freqHz: number,
): { amplitudeRms: number; noiseFloorRms: number } {
  const recBP = biquadBP(recorded, sr, freqHz, 0.707);

  let totalRms = 0;
  let burstCount = 0;
  for (const range of sampleRanges) {
    if (range.end > recBP.length) continue;
    const slice = recBP.subarray(range.start, range.end);
    totalRms += computeRMS(slice);
    burstCount++;
  }

  const noiseFloorRms = computeRMS(recBP.subarray(0, Math.round(PRE_BUF_MS / 1000 * sr)));
  return {
    amplitudeRms: burstCount > 0 ? totalRms / burstCount : 0,
    noiseFloorRms,
  };
}

function generateFreqList(): number[] {
  const freqs: number[] = [];
  const step = Math.pow(2, 1 / STEPS_PER_OCTAVE);
  let f = MIN_FREQ;
  while (f <= MAX_FREQ) {
    freqs.push(Math.round(f));
    f *= step;
  }
  return freqs;
}

export async function runMetaFreqTest(
  ctx: AudioContext,
  workletNode: AudioWorkletNode,
  onProgress?: (point: MetaFreqPoint, done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<MetaFreqResult> {
  const sr = ctx.sampleRate;
  const freqs = generateFreqList();
  const maxLatencySamples = Math.round(MAX_LATENCY_MS / 1000 * sr);
  const points: MetaFreqPoint[] = [];

  for (let fi = 0; fi < freqs.length; fi++) {
    if (signal?.aborted) break;

    const freqHz = freqs[fi];
    const { signal: sig, sampleRanges } = generateFreqBeepSignal(sr, freqHz);
    const playStartTime = ctx.currentTime + 0.05;
    const startFrame = Math.round(playStartTime * sr);
    const recordDuration = sig.length + maxLatencySamples;

    workletNode.port.postMessage({ type: 'RESET' });

    const result = await new Promise<Float32Array>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timeout at ${freqHz}Hz`)), 8000);
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'RESULT') {
          clearTimeout(timeout);
          workletNode.port.removeEventListener('message', handler);
          resolve(e.data.frames);
        }
      };
      workletNode.port.addEventListener('message', handler);
      workletNode.port.postMessage({ type: 'START', startFrame, duration: recordDuration });

      const audioBuffer = ctx.createBuffer(1, sig.length, sr);
      audioBuffer.getChannelData(0).set(sig);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.start(playStartTime);
    });

    const { amplitudeRms, noiseFloorRms } = measureFreqAmplitude(result, sampleRanges, sr, freqHz);
    const amplitudeDb = amplitudeRms > 1e-10 ? 20 * Math.log10(amplitudeRms) : -120;

    const point: MetaFreqPoint = { frequencyHz: freqHz, amplitudeRms, amplitudeDb, noiseFloorRms };
    points.push(point);
    onProgress?.(point, fi + 1, freqs.length);
  }

  if (points.length === 0) {
    return { success: false, points: [], peakFrequencyHz: 0, peakAmplitudeDb: -120, error: 'No frequencies tested' };
  }

  const best = points.reduce((a, b) => a.amplitudeRms > b.amplitudeRms ? a : b);
  return {
    success: true,
    points,
    peakFrequencyHz: best.frequencyHz,
    peakAmplitudeDb: best.amplitudeDb,
  };
}
