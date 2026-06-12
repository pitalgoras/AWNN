import { generateMLS, biquadBP, normalizeCrossCorrelation, peakToNoiseRatio, computeRMS, peakAmplitude, detectTrailingEdge } from './analysis';

const MLS_SEED = 42;
const MLS_DURATION = 0.5;
const WAKE_CLICKS = 3;
const CLICK_GAP = 0.25;
const MAX_LATENCY_MS = 500;
const DECIMATE = 4;

export interface MlsResult {
  success: boolean;
  latencyMs: number;
  confidence: number;
  peakToNoise: number;
  outputLatencyMs: number;
  heuristicMs: number;
  error?: string;
  recordedSamples: number;
  inputSamples: number;
  inputRms: number;
  inputPeak: number;
  actualStartFrame: number;
  expectedStartFrame: number;
  // End-detection (trailing edge of noise → silence)
  endLatencyMs: number;
  endConfidence: number;
  latencySource: 'start-correlation' | 'end-detection' | 'average';
}

export async function runMlsTest(
  ctx: AudioContext,
  workletNode: AudioWorkletNode,
  options?: { amplitude?: number },
): Promise<MlsResult> {
  const sr = ctx.sampleRate;
  const mlsLen = Math.floor(MLS_DURATION * sr);
  const outputLatMs = Math.round((ctx.outputLatency || 0) * 1000);
  const heuristicMs = Math.round(2 * (ctx.outputLatency || 0) * 1000);

  const amplitude = options?.amplitude ?? 0.2;
  const rawMls = generateMLS(MLS_SEED, mlsLen);
  const mlsRef = biquadBP(rawMls, sr, 4000, 0.707);

  const clickLen = Math.floor(0.05 * sr);
  const clickGapLen = Math.floor(CLICK_GAP * sr);
  const preMlsGap = Math.floor(0.1 * sr);
  const bufPadding = Math.floor(0.05 * sr);

  const totalSamples = bufPadding + (clickLen + clickGapLen) * WAKE_CLICKS - clickGapLen + preMlsGap + mlsLen;

  const audioBuffer = ctx.createBuffer(1, totalSamples, sr);
  const ch = audioBuffer.getChannelData(0);
  let pos = bufPadding;
  for (let w = 0; w < WAKE_CLICKS; w++) {
    for (let i = 0; i < clickLen && pos + i < totalSamples; i++) {
      const t = i / sr;
      ch[pos + i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 40) * amplitude;
    }
    pos += clickLen;
    if (w < WAKE_CLICKS - 1) {
      for (let i = 0; i < clickGapLen && pos + i < totalSamples; i++) ch[pos + i] = 0;
      pos += clickGapLen;
    }
  }
  pos += preMlsGap;
  for (let i = 0; i < mlsLen && pos + i < totalSamples; i++) ch[pos + i] = mlsRef[i] * amplitude;

  const playStartTime = ctx.currentTime + 0.1;
  const startFrame = Math.round(playStartTime * sr);
  const recordDuration = Math.round((totalSamples / sr + 0.5) * sr);

  // Reset worklet state and drain stale messages before each test
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
      resolve({ success: false, latencyMs: 0, confidence: 0, peakToNoise: 0, outputLatencyMs: outputLatMs, heuristicMs, error: 'Timeout: no response from worklet', recordedSamples: -1, inputSamples: -1, inputRms: 0, inputPeak: 0, actualStartFrame: -1, expectedStartFrame: startFrame, endLatencyMs: 0, endConfidence: 0, latencySource: 'start-correlation' });
    }, 15000);

    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'RESULT') {
        const recorded: Float32Array = e.data.frames;
        const msg = e.data as Record<string, unknown>;
        const inputSamples = (msg.inputSamples ?? 0) as number;
        const actualStartFrame = (msg.actualStartFrame ?? 0) as number;
        cleanup();
        clearTimeout(timeout);

        const rms = computeRMS(recorded);
        const peak = peakAmplitude(recorded);
        const diag = {
          recordedSamples: recorded.length,
          inputSamples,
          inputRms: rms,
          inputPeak: peak,
          actualStartFrame,
          expectedStartFrame: startFrame,
        };

        if (!recorded || recorded.length < sr / 2) {
          resolve({ success: false, latencyMs: 0, confidence: 0, peakToNoise: 0, outputLatencyMs: outputLatMs, heuristicMs, error: 'Recording too short', endLatencyMs: 0, endConfidence: 0, latencySource: 'start-correlation', ...diag });
          return;
        }

        const recFiltered = biquadBP(recorded, sr, 4000, 0.707);
        const recDec = decimate(recFiltered, DECIMATE);
        const refDec = decimate(mlsRef, DECIMATE);
        const decSr = Math.round(sr / DECIMATE);

        const mlsStartInRecording = bufPadding + (clickLen + clickGapLen) * WAKE_CLICKS - clickGapLen + preMlsGap;
        const expectedEndSample = startFrame + bufPadding + (clickLen + clickGapLen) * WAKE_CLICKS - clickGapLen + preMlsGap + mlsLen;
        const mlsDecPos = Math.round(mlsStartInRecording / DECIMATE);
        const latencyDec = Math.floor((MAX_LATENCY_MS / 1000) * decSr);

        const minShift = Math.max(0, mlsDecPos - latencyDec);
        const maxShift = mlsDecPos + latencyDec;

        const { lags, values } = normalizeCrossCorrelation(recDec, refDec, maxShift, minShift);

        // ─── Start-correlation analysis ───
        let startLatencyMs = 0, startConfidence = 0, startP2nDb = -Infinity;
        if (values.length > 0) {
          let bestIdx = 0;
          for (let i = 1; i < values.length; i++) {
            if (values[i] > values[bestIdx]) bestIdx = i;
          }
          startLatencyMs = ((lags[bestIdx] - mlsDecPos) / decSr) * 1000;
          startConfidence = values[bestIdx];
          const p2nLinear = peakToNoiseRatio(values);
          startP2nDb = 20 * Math.log10(p2nLinear + 1e-10);
        }

        // ─── End-detection analysis (trailing edge of noise → silence) ───
        const actualEndSample = actualStartFrame + (msg.inputSamples as number ?? recorded.length);
        const endResult = detectTrailingEdge(recorded, sr, expectedEndSample - startFrame, 300);
        const endLatencyMs = endResult.confidence > 0
          ? ((endResult.endSample - (expectedEndSample - startFrame)) / sr) * 1000
          : 0;

        // ─── Pick best result ───
        const useEnd = endResult.confidence > 0.3 && (startP2nDb < 10 || endResult.confidence > startConfidence);
        const latencyMs = useEnd ? endLatencyMs : startLatencyMs;
        const latencySource: MlsResult['latencySource'] = useEnd ? 'end-detection' : 'start-correlation';
        const confidence = useEnd ? endResult.confidence : startConfidence;

        if (!useEnd && startP2nDb < 18) {
          resolve({ success: false, latencyMs, confidence, peakToNoise: startP2nDb, outputLatencyMs: outputLatMs, heuristicMs, error: `Low confidence (P2N ${startP2nDb.toFixed(1)}dB, need >18dB)`, endLatencyMs, endConfidence: endResult.confidence, latencySource, ...diag });
          return;
        }

        if (!useEnd) {
          const diff = Math.abs(latencyMs - heuristicMs);
          if (diff > 50) {
            resolve({ success: true, latencyMs, confidence, peakToNoise: startP2nDb, outputLatencyMs: outputLatMs, heuristicMs, error: `Start-correlation ${latencyMs.toFixed(1)}ms differs from heuristic ${heuristicMs}ms — end-detection: ${endLatencyMs.toFixed(1)}ms (conf: ${endResult.confidence.toFixed(2)})`, endLatencyMs, endConfidence: endResult.confidence, latencySource, ...diag });
            return;
          }
        }

        resolve({ success: true, latencyMs, confidence, peakToNoise: useEnd ? 40 : startP2nDb, outputLatencyMs: outputLatMs, heuristicMs, endLatencyMs, endConfidence: endResult.confidence, latencySource, ...diag });
      }
    };

    const cleanup = () => {
      workletNode.port.removeEventListener('message', onMessage);
    };

    workletNode.port.addEventListener('message', onMessage);

    workletNode.port.postMessage({ type: 'START', startFrame, duration: recordDuration });

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(playStartTime);
  });
}

function decimate(signal: Float32Array, factor: number): Float32Array {
  const outLen = Math.floor(signal.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += signal[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}
