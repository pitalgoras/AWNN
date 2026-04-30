import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { X, Zap, Play, RotateCcw, Info } from 'lucide-react';

interface LatencyCalibrationModalProps {
  onClose: () => void;
}

export const LatencyCalibrationModal: React.FC<LatencyCalibrationModalProps> = ({ onClose }) => {
  const globalLatencyMs = useStore(s => s.globalLatencyMs);
  const setGlobalLatencyMs = useStore(s => s.setGlobalLatencyMs);
  const extraLatencyMs = useStore(s => s.extraLatencyMs);
  const setExtraLatencyMs = useStore(s => s.setExtraLatencyMs);
  
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [lastDetectedLatency, setLastDetectedLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const runAutoCalibration = async () => {
    setIsCalibrating(true);
    setCalibrationProgress(0);
    setError(null);
    setLastDetectedLatency(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: false, 
          noiseSuppression: false, 
          autoGainControl: false,
          // Try to get the rawest possible stream
        } 
      });
      streamRef.current = stream;
      
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioContextRef.current = ctx;
      
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(512, 1, 1);
      
      source.connect(processor);
      processor.connect(ctx.destination);
      
      const detectedLatencies: number[] = [];
      const numTests = 5;
      let currentTest = 0;
      let beepTime = 0;
      let isWaitingForBeep = false;

      const runNextTest = () => {
        if (currentTest >= numTests) {
          finishCalibration(detectedLatencies);
          return;
        }
        
        setCalibrationProgress((currentTest / numTests) * 100);
        
        // Schedule beep in 500ms
        beepTime = ctx.currentTime + 0.5;
        isWaitingForBeep = true;
        
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        
        osc.type = 'square';
        osc.frequency.value = 1000;
        
        env.gain.setValueAtTime(0, beepTime);
        env.gain.linearRampToValueAtTime(1, beepTime + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, beepTime + 0.05);
        
        osc.connect(env);
        env.connect(ctx.destination);
        
        osc.start(beepTime);
        osc.stop(beepTime + 0.1);
        
        currentTest++;
      };

      processor.onaudioprocess = (e) => {
        if (!isWaitingForBeep || beepTime === 0) return;
        
        const data = e.inputBuffer.getChannelData(0);
        const currentTime = ctx.currentTime;
        
        // Only start looking for the beep after it was scheduled to play
        if (currentTime < beepTime) return;
        
        for (let i = 0; i < data.length; i++) {
          if (Math.abs(data[i]) > 0.1) { // Threshold for the beep
            const sampleTime = currentTime + (i / ctx.sampleRate);
            const latencyMs = (sampleTime - beepTime) * 1000;
            
            if (latencyMs < 400) {
              detectedLatencies.push(latencyMs);
            }
            isWaitingForBeep = false;
            
            // Wait a bit before next test
            setTimeout(runNextTest, 300);
            return;
          }
        }
        
        // Timeout if no beep detected within 400ms of scheduled time
        if (currentTime > beepTime + 0.4) {
          isWaitingForBeep = false;
          setTimeout(runNextTest, 100);
        }
      };

      const finishCalibration = (latencies: number[]) => {
        processor.disconnect();
        source.disconnect();
        ctx.close();
        stream.getTracks().forEach(t => t.stop());
        
        setIsCalibrating(false);
        setCalibrationProgress(100);

        if (latencies.length > 0) {
          // Average the results, excluding outliers if needed
          const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
          const final = Math.max(0, Math.min(1000, Math.round(avg)));
          setLastDetectedLatency(final);
          setGlobalLatencyMs(final);
        } else {
          setError("Could not detect the test tone. Ensure your speakers are audible to the microphone.");
        }
      };

      // Start first test
      runNextTest();

    } catch (err) {
      console.error(err);
      setError("Microphone access denied or audio error.");
      setIsCalibrating(false);
    }
  };

  useEffect(() => {
    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[250] flex items-center justify-center p-2 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md max-h-[95vh] overflow-hidden shadow-2xl relative flex flex-col">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Auto Calibration</h2>
                <p className="text-[10px] text-zinc-500">Sync your audio perfectly</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
            >
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4 text-sm text-zinc-300 cursor-default">
          {/* Auto Calibration Section */}
          <div className="bg-zinc-800/30 rounded-lg p-4 border border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Auto Calibration</h3>
              {lastDetectedLatency !== null && (
                <span className="text-[9px] font-bold bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  Detected: {lastDetectedLatency}ms
                </span>
              )}
            </div>
            
            <p className="text-[10px] text-zinc-500 mb-4 leading-snug">
              Plays clicks and listens through microphone to measure latency.
            </p>

            {isCalibrating ? (
              <div className="space-y-3">
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${calibrationProgress}%` }}
                  />
                </div>
                <div className="text-center text-[9px] font-bold text-blue-400 animate-pulse uppercase tracking-widest">
                  Calibrating... Keep it quiet
                </div>
              </div>
            ) : (
              <button 
                onClick={runAutoCalibration}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-md transition-all flex items-center justify-center gap-1.5 group text-xs text-[10px]"
              >
                <Play className="w-3.5 h-3.5 fill-current group-hover:scale-110 transition-transform" />
                Run Calibrator
              </button>
            )}

            {error && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-md text-[9px] text-red-400 flex items-start gap-1.5">
                <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
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
        <div className="p-3 bg-zinc-900/80 border-t border-zinc-800 shrink-0">
          <button 
            onClick={onClose}
            className="w-full py-2.5 bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-bold rounded-lg transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
