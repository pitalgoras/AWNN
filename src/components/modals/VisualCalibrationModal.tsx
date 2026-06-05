import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { ModalShell } from './ModalShell';
import { VisualCalibrator, CalibrationCapture } from '../../audio/calibration/VisualCalibrator';
import { Play, RotateCcw, Check, AlertTriangle, Bluetooth } from 'lucide-react';

interface VisualCalibrationModalProps {
  show: boolean;
  onClose: () => void;
}

export const VisualCalibrationModal: React.FC<VisualCalibrationModalProps> = ({ show, onClose }) => {
  const outputLatencyMs = useStore(s => s.outputLatencyMs);
  const baseLatencyMs = useStore(s => s.baseLatencyMs);
  const extraLatencyMs = useStore(s => s.extraLatencyMs);
  const setExtraLatencyMs = useStore(s => s.setExtraLatencyMs);
  const setDeviceLatency = useStore(s => s.setDeviceLatency);

  const [capture, setCapture] = useState<CalibrationCapture | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [totalRoundtripMs, setTotalRoundtripMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState('');
  const [deviceChanged, setDeviceChanged] = useState(false);
  const [wakeUpClicks, setWakeUpClicks] = useState(0);

  const calibratorRef = useRef<VisualCalibrator | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const runCalibration = useCallback(async () => {
    setIsCalibrating(true);
    setError(null);
    setCapture(null);
    setDeviceChanged(false);

    try {
      const ctx = (window as any).__audioContext;
      if (!ctx) throw new Error('No AudioContext available');

      const calibrator = new VisualCalibrator(ctx);
      calibratorRef.current = calibrator;

      await calibrator.init();
      const result = await calibrator.run(120, 8, wakeUpClicks);

      const fp = `${calibrator.inputDeviceId}-${Math.round(result.outputLatencyMs / 5) * 5}`;
      setDeviceFingerprint(fp);

      const browserLatency = result.outputLatencyMs + result.baseLatencyMs;
      setTotalRoundtripMs(browserLatency);

      setCapture(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calibration failed');
    } finally {
      setIsCalibrating(false);
    }
  }, [wakeUpClicks]);

  useEffect(() => {
    if (!show) {
      calibratorRef.current?.cleanup();
      calibratorRef.current = null;
      setCapture(null);
      setError(null);
      setDeviceChanged(false);
    }
  }, [show]);

  useEffect(() => {
    return () => {
      calibratorRef.current?.cleanup();
      calibratorRef.current = null;
    };
  }, []);

  // Detect device changes while a capture exists
  useEffect(() => {
    if (!capture) return;
    const handler = () => setDeviceChanged(true);
    navigator.mediaDevices?.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handler);
  }, [capture]);

  useEffect(() => {
    if (!capture || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, w, h);

    const { frames, startFrame, clicks } = capture;
    const frameCount = frames.length;
    if (frameCount === 0) return;

    const blockSize = Math.ceil(frameCount / w);
    const peaks = new Float32Array(w);
    for (let i = 0; i < w; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, frameCount);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(frames[j]);
        if (abs > peak) peak = abs;
      }
      peaks[i] = peak;
    }

    const maxPeak = Math.max(...Array.from(peaks), 0.001);
    const midY = h / 2;

    ctx.beginPath();
    ctx.moveTo(0, midY);
    for (let x = 0; x < w; x++) {
      const norm = peaks[x] / maxPeak;
      ctx.lineTo(x, midY - norm * (h * 0.4));
    }
    ctx.lineTo(w, midY);
    ctx.lineTo(w, midY + peaks[w - 1] / maxPeak * (h * 0.4));
    for (let x = w - 1; x >= 0; x--) {
      const norm = peaks[x] / maxPeak;
      ctx.lineTo(x, midY + norm * (h * 0.4));
    }
    ctx.closePath();
    ctx.fillStyle = '#3b82f6';
    ctx.fill();

    const offsetFrames = Math.round(totalRoundtripMs * clicks.sampleRate / 1000);
    const clickColor = '#fbbf24';

    clicks.clickTimes.forEach((t, i) => {
      const frameInBuffer = Math.round(t * clicks.sampleRate) - startFrame + offsetFrames;
      const x = (frameInBuffer / frameCount) * w;
      if (x < 0 || x > w) return;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = i === clicks.clickTimes.length - 1 ? '#f87171' : clickColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = clickColor;
      ctx.font = '9px monospace';
      ctx.fillText(`${clicks.clickTimes.length - i}`, x + 3, 12);
    });

    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [capture, totalRoundtripMs]);

  const handleAccept = () => {
    if (!capture) return;

    setDeviceLatency({
      deviceFingerprint,
      label: `Visual calibration (${capture.clicks.bpm}BPM, ${capture.clicks.clickTimes.length} clicks)`,
      totalRoundtripMs,
      extraLatencyMs: 0,
      lastCalibrated: Date.now(),
      calibrationMethod: 'visual',
    });
    onClose();
  };

  const handleRetry = () => {
    calibratorRef.current?.cleanup();
    calibratorRef.current = null;
    setCapture(null);
    setTotalRoundtripMs(0);
    runCalibration();
  };

  return (
    <ModalShell show={show} onClose={onClose} title="Visual Calibration" maxWidth="max-w-lg" singleColumn>
      <div className="space-y-4 text-sm text-zinc-300 cursor-default">
        <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
          <p className="text-[10px] text-zinc-500 leading-snug">
            Plays 8 clicks through your speakers and records them via microphone.
            Click markers are numbered from last (anchor, half-beat early) to first.
            Adjust the slider until <strong className="text-zinc-400">marker 1</strong> aligns with the
            last waveform peak.
          </p>
        </div>

        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-md text-[9px] text-red-400 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isCalibrating && (
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] text-zinc-400">Recording click pattern...</span>
            </div>
          </div>
        )}

        {capture && !isCalibrating && (
          <>
            {deviceChanged && (
              <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-md text-[9px] text-amber-400 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>Audio device changed since capture — retry calibration for accuracy.</span>
              </div>
            )}
            <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Waveform</h3>
                <span className="text-[9px] text-zinc-500 font-mono">
                  {capture.clicks.clickTimes.length} clicks &middot; {capture.clicks.bpm} BPM
                </span>
              </div>
              <canvas
                ref={canvasRef}
                className="w-full h-40 rounded-md"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

            <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Round-trip Latency</h3>
                <div className="text-lg font-mono font-bold text-amber-400">{totalRoundtripMs}ms</div>
              </div>

              <div className="relative mb-3">
                <input
                  type="range"
                  min="0"
                  max="500"
                  step="1"
                  value={totalRoundtripMs}
                  onChange={(e) => setTotalRoundtripMs(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between mt-1 text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">
                  <span>0ms</span>
                  <span>Browser: {capture.outputLatencyMs + capture.baseLatencyMs}ms</span>
                  <span>500ms</span>
                </div>
              </div>

              <div className="flex gap-1.5 mb-3">
                <button
                  onClick={() => setTotalRoundtripMs(Math.max(0, totalRoundtripMs - 1))}
                  className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                >
                  -1ms
                </button>
                <button
                  onClick={() => setTotalRoundtripMs(Math.min(500, totalRoundtripMs + 1))}
                  className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                >
                  +1ms
                </button>
                <button
                  onClick={() => setTotalRoundtripMs(capture.outputLatencyMs + capture.baseLatencyMs)}
                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded text-[10px] font-bold"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>

              <div className="pt-3 border-t border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-zinc-500">Extra fine-tune offset</span>
                  <span className="text-sm font-mono font-bold text-cyan-400">
                    {extraLatencyMs > 0 ? `+${extraLatencyMs}` : extraLatencyMs}ms
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setExtraLatencyMs(Math.max(-500, extraLatencyMs - 10))}
                    className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                  >
                    -10ms
                  </button>
                  <button
                    onClick={() => setExtraLatencyMs(Math.min(500, extraLatencyMs + 10))}
                    className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                  >
                    +10ms
                  </button>
                  <button
                    onClick={() => setExtraLatencyMs(0)}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded text-[10px] font-bold"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-800">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-zinc-500">Device</span>
                <span className="font-mono text-zinc-400 truncate ml-2 max-w-[200px]">{deviceFingerprint}</span>
              </div>
              <div className="flex items-center justify-between text-[9px] mt-1">
                <span className="text-zinc-500">Browser</span>
                <span className="font-mono text-zinc-400">
                  out={capture.outputLatencyMs}ms base={capture.baseLatencyMs}ms
                </span>
              </div>
              <div className="flex items-center justify-between text-[9px] mt-1">
                <span className="text-zinc-500">Commit formula</span>
                <span className="font-mono text-zinc-400">
                  totalRoundtrip={totalRoundtripMs}ms + extra={extraLatencyMs}ms = {totalRoundtripMs + extraLatencyMs}ms
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAccept}
                disabled={deviceChanged}
                className={`flex-1 py-2.5 font-bold rounded-md transition-all text-[10px] flex items-center justify-center gap-1.5 ${
                  deviceChanged
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                {deviceChanged ? 'Retry Required' : 'Accept Calibration'}
              </button>
              <button
                onClick={handleRetry}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-md transition-all text-[10px] flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          </>
        )}

        {!capture && !isCalibrating && !error && (
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800 space-y-3">
            <label className="flex items-center gap-2 text-[10px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={wakeUpClicks > 0}
                onChange={(e) => setWakeUpClicks(e.target.checked ? 3 : 0)}
                className="accent-zinc-500"
              />
              <Bluetooth className="w-3 h-3" />
              Bluetooth speaker (adds 3 wake-up clicks)
            </label>
            <button
              onClick={runCalibration}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-md transition-all flex items-center justify-center gap-2 text-xs"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Calibration
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
