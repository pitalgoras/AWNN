export function computeRMS(signal: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < signal.length; i++) sumSq += signal[i] * signal[i];
  return Math.sqrt(sumSq / signal.length);
}

export function peakAmplitude(signal: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    const abs = Math.abs(signal[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

export function shortTermEnergy(signal: Float32Array, windowSize: number): Float32Array {
  const out = new Float32Array(Math.floor(signal.length / windowSize));
  for (let i = 0; i < out.length; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, signal.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += signal[j] * signal[j];
    out[i] = sum / (end - start);
  }
  return out;
}

export function detectPeaks(envelope: Float32Array, threshold: number, minGap: number): number[] {
  const peaks: number[] = [];
  let lastPeak = -minGap;
  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1]) {
      if (i - lastPeak >= minGap) {
        peaks.push(i);
        lastPeak = i;
      }
    }
  }
  return peaks;
}

export function crestFactor(signal: Float32Array): number {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < signal.length; i++) {
    const abs = Math.abs(signal[i]);
    if (abs > peak) peak = abs;
    sumSq += signal[i] * signal[i];
  }
  const rms = Math.sqrt(sumSq / signal.length);
  return rms > 0 ? peak / rms : 0;
}

export function normalizeCrossCorrelation(
  recorded: Float32Array,
  pattern: Float32Array,
  maxShift: number,
  minShift = 0,
): { lags: number[]; values: number[] } {
  const patternLen = pattern.length;
  const maxS = Math.min(maxShift, recorded.length - patternLen);
  const actualMin = Math.min(minShift, Math.max(0, maxS - 1));
  const patternEnergy = dot(pattern, pattern);
  const lags: number[] = [];
  const values: number[] = [];

  for (let shift = actualMin; shift < maxS; shift++) {
    let corr = 0;
    for (let i = 0; i < patternLen; i++) corr += recorded[shift + i] * pattern[i];
    const windowSlice = recorded.subarray(shift, shift + patternLen);
    const windowEnergy = dot(windowSlice, windowSlice);
    const norm = Math.sqrt(patternEnergy * windowEnergy);
    lags.push(shift);
    values.push(norm > 1e-10 ? corr / norm : 0);
  }
  return { lags, values };
}

export function peakToNoiseRatio(corrValues: number[]): number {
  if (corrValues.length < 10) return 0;
  const peak = Math.max(...corrValues);
  const peakIdx = corrValues.indexOf(peak);
  const excluded = new Set([peakIdx - 3, peakIdx - 2, peakIdx - 1, peakIdx, peakIdx + 1, peakIdx + 2, peakIdx + 3]);
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < corrValues.length; i++) {
    if (!excluded.has(i)) {
      sumSq += corrValues[i] * corrValues[i];
      count++;
    }
  }
  const noiseFloor = count > 0 ? Math.sqrt(sumSq / count) : 1e-10;
  return noiseFloor > 1e-10 ? peak / noiseFloor : 0;
}

export function generateMLS(seed: number, length: number): Float32Array {
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

export function biquadBP(signal: Float32Array, sr: number, f0: number, Q: number): Float32Array {
  const w0 = 2 * Math.PI * f0 / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw0 = Math.cos(w0);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const b0n = b0 / a0, b1n = b1 / a0, b2n = b2 / a0;
  const a1n = a1 / a0, a2n = a2 / a0;

  const out = new Float32Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = b0n * x + b1n * x1 + b2n * x2 - a1n * y1 - a2n * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

export function biquadHP(signal: Float32Array, sr: number, f0: number): Float32Array {
  const w0 = 2 * Math.PI * f0 / sr;
  const Q = 0.707;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw0 = Math.cos(w0);

  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const b0n = b0 / a0, b1n = b1 / a0, b2n = b2 / a0;
  const a1n = a1 / a0, a2n = a2 / a0;

  const out = new Float32Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = b0n * x + b1n * x1 + b2n * x2 - a1n * y1 - a2n * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

export function detectTrailingEdge(
  signal: Float32Array,
  sampleRate: number,
  expectedEndSample: number,
  searchWindowMs = 300,
): { endSample: number; confidence: number; envelope: { t: number[]; e: number[] } } {
  const windowSize = Math.floor(0.005 * sampleRate);
  const hopSize = Math.floor(0.002 * sampleRate);
  const envelope: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < signal.length - windowSize; i += hopSize) {
    let sumSq = 0;
    for (let j = 0; j < windowSize; j++) sumSq += signal[i + j] * signal[i + j];
    envelope.push(Math.sqrt(sumSq / windowSize));
    times.push((i + windowSize / 2) / sampleRate);
  }

  const searchSamples = Math.floor(searchWindowMs / 1000 * sampleRate);
  const searchStart = Math.max(0, Math.floor((expectedEndSample - searchSamples) / hopSize));
  const searchEnd = Math.min(envelope.length - 1, Math.ceil((expectedEndSample + searchSamples) / hopSize));

  const searchEnv = envelope.slice(searchStart, searchEnd + 1);
  const peak = Math.max(...searchEnv);
  const noiseEst = envelope.slice(0, Math.min(50, envelope.length)).reduce((a, b) => a + b, 0) / Math.min(50, envelope.length);
  const threshold = Math.max(noiseEst * 4, peak * 0.08);

  // Scan backward from searchEnd: find last index where envelope > threshold
  let endIdx = searchEnd;
  while (endIdx >= searchStart && envelope[endIdx] <= threshold) endIdx--;
  while (endIdx > searchStart && envelope[endIdx - 1] > threshold) endIdx--;

  if (endIdx < searchStart || endIdx >= envelope.length) {
    return { endSample: expectedEndSample, confidence: 0, envelope: { t: times, e: envelope } };
  }

  const endSample = Math.round(times[endIdx] * sampleRate);
  const slope = endIdx > 0 && endIdx < envelope.length - 1
    ? Math.abs(envelope[endIdx + 1] - envelope[endIdx - 1]) / (2 * (times[endIdx + 1] - times[endIdx - 1]))
    : 0;
  const confidence = Math.min(1, slope / (peak * 10));
  return { endSample, confidence, envelope: { t: times, e: envelope } };
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateNoise(seed: number, length: number, amplitude = 0.3): Float32Array {
  const rng = mulberry32(seed);
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) buf[i] = (rng() * 2 - 1) * amplitude;
  return buf;
}
