import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { Zap, Play, RotateCcw, Info } from 'lucide-react';
import { LatencyCalibrator, LatencyCalibrationResult, ProbeCycleData } from '../../lib/audio/LatencyCalibrator';
import { ModalShell } from './ModalShell';
import { ProbeMonitor } from './ProbeMonitor';

interface LatencyCalibrationModalProps {
  show: boolean;
  onClose: () => void;
  autoStart?: boolean;
}

export const LatencyCalibrationModal: React.FC<LatencyCalibrationModalProps> = ({ show, onClose, autoStart }) => {
  const globalLatencyMs = useStore(s => s.globalLatencyMs);
  const setGlobalLatencyMs = useStore(s => s.setGlobalLatencyMs);
  const extraLatencyMs = useStore(s => s.extraLatencyMs);
  const setExtraLatencyMs = useStore(s => s.setExtraLatencyMs);
  const outputLatencyMs = useStore(s => s.outputLatencyMs);
  const baseLatencyMs = useStore(s => s.baseLatencyMs);
  const refreshAudioLatency = useStore(s => s.refreshAudioLatency);

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [lastDetectedLatency, setLastDetectedLatency] = useState<number | null>(null);
  const [lastSignalQuality, setLastSignalQuality] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [continuousProbe, setContinuousProbe] = useState(false);
  const [probeCycles, setProbeCycles] = useState<ProbeCycleData[]>([]);
  const [probeActive, setProbeActive] = useState(false);

  const calibratorRef = useRef<LatencyCalibrator | null>(null);

  const stopProbe = () => {
    if (calibratorRef.current) {
      calibratorRef.current.cancel();
      calibratorRef.current = null;
      setIsCalibrating(false);
      setProbeActive(false);
      setStatusText(null);
    }
  };

  const runAutoCalibration = async () => {
    setIsCalibrating(true);
    setCalibrationProgress(0);
    setStatusText(null);
    setError(null);
    setLastDetectedLatency(null);
    setLastSignalQuality(null);
    setProbeCycles([]);
    setProbeActive(true);

    // Cancel any existing calibration
    if (calibratorRef.current) {
      calibratorRef.current.cancel();
    }

    const calibrator = new LatencyCalibrator(
      {
        onProgress: (progress) => setCalibrationProgress(progress),
        onStatus: (status) => setStatusText(status),
        onProbeReading: (data: ProbeCycleData, history: ProbeCycleData[]) => {
          setProbeCycles([...history]);
        },
        onComplete: (result: LatencyCalibrationResult & { signalQuality?: string }) => {
          setIsCalibrating(false);
          setProbeActive(false);
          setCalibrationProgress(100);
          setStatusText(null);

          if (result.success && result.averageLatencyMs > 0) {
            setLastDetectedLatency(result.averageLatencyMs);
            setLastSignalQuality((result as any).signalQuality || 'good');
            setGlobalLatencyMs(result.averageLatencyMs);
          } else {
            setError(result.error || "Could not detect the test tone. Ensure your speakers are audible to the microphone.");
          }
          calibratorRef.current = null;
        },
        onError: (errorMsg: string) => {
          setError(errorMsg);
          setIsCalibrating(false);
          setProbeActive(false);
          setStatusText(null);
          calibratorRef.current = null;
        }
      },
      { continuousProbe }
    );

    calibratorRef.current = calibrator;
    calibrator.calibrate();
  };

  useEffect(() => {
    return () => {
      // Cancel calibration on unmount
      if (calibratorRef.current) {
        calibratorRef.current.cancel();
        calibratorRef.current = null;
      }
    };
  }, []);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (show && autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      runAutoCalibration();
    }
    if (!show) autoStartedRef.current = false;
  }, [show, autoStart]);

  return (
    <ModalShell show={show} onClose={onClose} title="Auto Calibration" maxWidth="max-w-md" singleColumn>
      <div className="space-y-4 text-sm text-zinc-300 cursor-default">
          {/* Auto Calibration Section */}
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Auto Calibration</h3>
              {lastDetectedLatency !== null && (
                <span className="text-[9px] font-bold bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1.5">
                  <span>{lastDetectedLatency}ms</span>
                  {lastSignalQuality === 'good' && <span className="text-emerald-400">●</span>}
                  {lastSignalQuality === 'weak' && <span className="text-amber-400">●</span>}
                  {lastSignalQuality === 'clipping' && <span className="text-red-400">●</span>}
                </span>
              )}
            </div>
            
            <p className="text-[10px] text-zinc-500 mb-4 leading-snug">
              Plays a continuous noise pattern through speakers, measures round-trip latency via microphone correlation.
            </p>

            {isCalibrating ? (
              <div className="space-y-3">
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${calibrationProgress}%` }}
                  />
                </div>
                {statusText && (
                  <div className="text-center text-[9px] text-zinc-400 leading-snug">
                    {statusText}
                  </div>
                )}

                {/* Live probe monitor */}
                {probeActive && probeCycles.length > 0 && (
                  <div className="bg-zinc-900/50 rounded p-2 border border-zinc-800">
                    {/* Stop button — always visible, fixed position */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Live Probe</span>
                      <button onClick={stopProbe}
                        className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-[10px] transition-all"
                      >
                        {continuousProbe ? 'Stop' : 'Stop (auto)'}
                      </button>
                    </div>
                    <ProbeMonitor
                      cycle={probeCycles[probeCycles.length - 1]}
                      cycleCount={probeCycles.length}
                      floorPeak={calibratorRef.current?.floorPeak}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={runAutoCalibration}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-md transition-all flex items-center justify-center gap-1.5 group text-xs text-[10px]"
                >
                  <Play className="w-3.5 h-3.5 fill-current group-hover:scale-110 transition-transform" />
                  Run Calibrator
                </button>

                {/* Non-stop debug toggle */}
                <label className="flex items-center gap-2 text-[9px] text-zinc-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={continuousProbe}
                    onChange={(e) => setContinuousProbe(e.target.checked)}
                    className="accent-zinc-500"
                  />
                  Non-stop debug mode (probe keeps running after auto-stop would trigger)
                </label>
              </div>
            )}

            {error && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-md text-[9px] text-red-400 flex items-start gap-1.5">
                <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Browser Latency Section */}
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Browser Latency</h3>
              <button onClick={refreshAudioLatency}
                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] transition-all flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Refresh
              </button>
            </div>
            <div className="flex gap-4 text-[11px] font-mono">
              <span>Output: <span className="text-zinc-200 font-bold">{outputLatencyMs}ms</span></span>
              <span>Base: <span className="text-zinc-200 font-bold">{baseLatencyMs}ms</span></span>
              <span>Total: <span className="text-cyan-400 font-bold">{outputLatencyMs + baseLatencyMs}ms</span></span>
            </div>
            <p className="text-[9px] text-zinc-600 mt-1.5 leading-snug">
              Browser-reported playback delay. Includes audio output buffer + device latency.
              Refresh after changing audio output device.
            </p>
          </div>

          {/* Manual Adjustment Section */}
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Base Latency</h3>
              <div className="text-lg font-mono font-bold text-blue-400">{globalLatencyMs}ms</div>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <input 
                  type="range" 
                  min="-200" max="500" step="1" 
                  value={globalLatencyMs}
                  onChange={(e) => setGlobalLatencyMs(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between mt-1 text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">
                  <span>-200ms</span>
                  <span>0</span>
                  <span>500ms</span>
                </div>
              </div>

              <div className="flex gap-1.5">
                <button 
                  onClick={() => setGlobalLatencyMs(Math.max(-200, globalLatencyMs - 1))}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                >
                  -1ms
                </button>
                <button 
                  onClick={() => setGlobalLatencyMs(Math.min(500, globalLatencyMs + 1))}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                >
                  +1ms
                </button>
                <button 
                  onClick={() => setGlobalLatencyMs(0)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded text-[10px] font-bold"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Extra Recording Offset Section */}
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Extra Offset</h3>
              <div className="text-lg font-mono font-bold text-amber-400">
                {extraLatencyMs > 0 ? `+${extraLatencyMs}` : extraLatencyMs}ms
              </div>
            </div>
            
            <p className="text-[10px] text-zinc-500 mb-4 leading-snug">
              Offset all new recordings.
              {extraLatencyMs > 0 ? " EARLIER." : extraLatencyMs < 0 ? " LATER." : ""}
            </p>

            <div className="space-y-3">
              <div className="relative">
                <input 
                  type="range" 
                  min="-500" max="500" step="1" 
                  value={extraLatencyMs}
                  onChange={(e) => setExtraLatencyMs(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between mt-1 text-[9px] font-bold text-zinc-600 uppercase tracking-tighter">
                  <span>-500ms</span>
                  <span>0</span>
                  <span>500ms</span>
                </div>
              </div>

              <div className="flex gap-1.5">
                <button 
                  onClick={() => setExtraLatencyMs(Math.max(-500, extraLatencyMs - 10))}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                >
                  -10ms
                </button>
                <button 
                  onClick={() => setExtraLatencyMs(Math.min(500, extraLatencyMs + 10))}
                  className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-[10px] font-bold"
                >
                  +10ms
                </button>
                <button 
                  onClick={() => setExtraLatencyMs(0)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded text-[10px] font-bold"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
    </ModalShell>
  );
};
