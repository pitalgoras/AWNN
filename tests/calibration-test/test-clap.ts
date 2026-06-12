import { shortTermEnergy, detectPeaks, crestFactor } from './analysis';

const WARMUP_BARS = 2;
const PATTERN_BEATS = [0, 1, 1.5, 2, 3, 3.5, 4.5];
const RESPONSE_BARS = 2;
const MAX_EXPECTED_LATENCY_MS = 500;

export interface ClapResult {
  success: boolean;
  latencyMs: number;
  clapCount: number;
  stdDev: number;
  confidence: number;
  error?: string;
}

export async function runClapTest(
  ctx: AudioContext,
  workletNode: AudioWorkletNode,
  bpm: number = 120,
): Promise<ClapResult> {
  const sr = ctx.sampleRate;
  const beatsPerSec = bpm / 60;
  const beatFrames = Math.round(sr / beatsPerSec);

  const warmupFrames = Math.floor(WARMUP_BARS * 4 * beatFrames);
  const patternOnsetFrames = PATTERN_BEATS.map(b => Math.floor(b * beatFrames));
  const totalPatternFrames = patternOnsetFrames[patternOnsetFrames.length - 1] + Math.floor(0.5 * sr);
  const responseFrames = Math.floor(RESPONSE_BARS * 4 * beatFrames);
  const totalFrames = warmupFrames + Math.floor(0.5 * sr) + totalPatternFrames + responseFrames;

  const clickLen = Math.floor(0.04 * sr);
  const clickGap = Math.floor(0.1 * sr);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ success: false, latencyMs: 0, clapCount: 0, stdDev: 0, confidence: 0, error: 'Timeout' });
    }, 30000);

    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'RESULT') {
        const recordedBuffer = e.data.frames;
        cleanup();
        clearTimeout(timeout);

        if (!recordedBuffer || recordedBuffer.length < sr) {
          resolve({ success: false, latencyMs: 0, clapCount: 0, stdDev: 0, confidence: 0, error: 'Recording too short' });
          return;
        }

        // Recording starts precisely at response window (worklet honors startFrame)
        // So recordedBuffer[0] corresponds to responseStart in audio timeline
        // No offset calculation needed
        const responseSignal = recordedBuffer;

        const cf = crestFactor(responseSignal);
        if (cf < 5) {
          resolve({ success: false, latencyMs: 0, clapCount: 0, stdDev: 0, confidence: 0, error: `No clear clap detected (crest factor ${cf.toFixed(1)}, need >5)` });
          return;
        }

        const envelope = shortTermEnergy(responseSignal, Math.floor(sr * 0.01));
        const envMax = Math.max(...Array.from(envelope));
        const threshold = envMax * 0.15;
        const minGap = Math.floor(sr * 0.08 / Math.floor(sr * 0.01));
        const peakIndices = detectPeaks(envelope, threshold, minGap);
        const clapWindows = peakIndices.map(p => p * Math.floor(sr * 0.01));

        const expectedOnsets = PATTERN_BEATS.map(b => Math.round(b * beatFrames));

        if (clapWindows.length < 3) {
          resolve({ success: false, latencyMs: 0, clapCount: clapWindows.length, stdDev: 0, confidence: 0, error: `Only ${clapWindows.length} claps detected, need ≥3` });
          return;
        }

        const bestShift = findBestShift(
          clapWindows,
          expectedOnsets,
          Math.floor((MAX_EXPECTED_LATENCY_MS / 1000) * sr),
          sr,
        );

        const matchedClaps: number[] = [];
        const matchedExpected: number[] = [];
        const maxMatchDist = Math.floor(0.12 * sr);
        for (const ec of expectedOnsets) {
          const shifted = ec + bestShift;
          const closest = clapWindows.reduce((best, c) =>
            Math.abs(c - shifted) < Math.abs(best - shifted) ? c : best, clapWindows[0]);
          if (Math.abs(closest - shifted) < maxMatchDist) {
            matchedClaps.push(closest - shifted);
            matchedExpected.push(ec);
          }
        }

        if (matchedClaps.length < 3) {
          resolve({ success: false, latencyMs: 0, clapCount: clapWindows.length, stdDev: 0, confidence: 0, error: `Could not match pattern to claps (${matchedClaps.length} matched)` });
          return;
        }

        const mean = matchedClaps.reduce((a, b) => a + b, 0) / matchedClaps.length;
        const variance = matchedClaps.reduce((a, b) => a + (b - mean) ** 2, 0) / matchedClaps.length;
        const stdDev = Math.sqrt(variance);
        const latencyMs = (mean / sr) * 1000;

        if (stdDev / sr * 1000 > 30) {
          resolve({ success: false, latencyMs, clapCount: matchedClaps.length, stdDev: stdDev / sr * 1000, confidence: 0, error: `High jitter (σ=${(stdDev / sr * 1000).toFixed(1)}ms, need <30ms)` });
          return;
        }

        resolve({ success: true, latencyMs, clapCount: matchedClaps.length, stdDev: stdDev / sr * 1000, confidence: 1 - stdDev / (mean + 1) });
      }
    };

    const cleanup = () => {
      workletNode.port.removeEventListener('message', onMessage);
    };

    workletNode.port.addEventListener('message', onMessage);

    const playStartTime = ctx.currentTime + 0.2;
    const playStartFrame = Math.round(playStartTime * sr);
    const responseStartFrame = playStartFrame + warmupFrames + Math.floor(0.5 * sr) + totalPatternFrames;

    workletNode.port.postMessage({ type: 'START', startFrame: responseStartFrame, duration: responseFrames });

    const audioBuffer = ctx.createBuffer(1, totalFrames, sr);
    const ch = audioBuffer.getChannelData(0);

    function writeClick(pos: number) {
      for (let i = 0; i < clickLen && pos + i < totalFrames; i++) {
        const t = i / sr;
        ch[pos + i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 30) * 0.5;
      }
      for (let i = clickLen; i < clickLen + clickGap && pos + i < totalFrames; i++) {
        ch[pos + i] = 0;
      }
    }

    let pos = 0;
    for (let b = 0; b < WARMUP_BARS * 4; b++) {
      writeClick(pos);
      pos += beatFrames;
    }

    pos += Math.floor(0.5 * sr);

    for (const onset of patternOnsetFrames) {
      writeClick(pos + onset);
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(playStartTime);
  });
}

function findBestShift(
  clapWindows: number[],
  expectedOnsets: number[],
  maxShift: number,
  sr: number,
): number {
  let bestShift = 0;
  let bestScore = -Infinity;
  const step = Math.floor(sr * 0.0005);

  for (let shift = 0; shift <= maxShift; shift += step) {
    let score = 0;
    for (const ec of expectedOnsets) {
      const target = ec + shift;
      const dist = clapWindows.reduce(
        (min, c) => Math.min(min, Math.abs(c - target)),
        Infinity,
      );
      score += Math.max(0, 1 - dist / (sr * 0.05));
    }
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  return bestShift;
}
