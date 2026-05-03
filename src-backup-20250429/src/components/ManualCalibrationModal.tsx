import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { X, Zap } from 'lucide-react';

interface ManualCalibrationModalProps {
  onClose: () => void;
}

export const ManualCalibrationModal: React.FC<ManualCalibrationModalProps> = ({ onClose }) => {
  const { bpm, setGlobalLatencyMs } = useStore();
  const [step, setStep] = useState<'idle' | 'counting' | 'finished'>('idle');
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextBeatTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const playClick = (time: number, freq: number) => {
    if (!audioContextRef.current) return;
    const osc = audioContextRef.current.createOscillator();
    const env = audioContextRef.current.createGain();
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.5, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(env);
    env.connect(audioContextRef.current.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  };

  const startCalibration = () => {
    audioContextRef.current = new (window.AudioContext || (window as (typeof window & { webkitAudioContext: typeof AudioContext })).webkitAudioContext)();
    setStep('counting');
    setCount(0);
    
    const secondsPerBeat = 60 / bpm;
    const startTime = audioContextRef.current.currentTime + 0.5;
    
    for (let i = 0; i < 4; i++) {
      const beatTime = startTime + (i * secondsPerBeat);
      playClick(beatTime, i === 0 ? 880 : 440);
      
      // Update UI count
      setTimeout(() => {
        setCount(i + 1);
      }, (beatTime - audioContextRef.current.currentTime) * 1000);
    }
    
    // The 5th beat is the target
    nextBeatTimeRef.current = performance.now() + (startTime + (4 * secondsPerBeat) - audioContextRef.current.currentTime) * 1000;
    
    timerRef.current = setTimeout(() => {
      if (step === 'counting') {
        setStep('idle');
        alert("You missed the tap! Try again.");
      }
    }, (startTime + (5 * secondsPerBeat) - audioContextRef.current.currentTime) * 1000);
  };

  const handleTap = () => {
    if (step !== 'counting' || count < 3) return;
    
    const tapTime = performance.now();
    const diff = tapTime - nextBeatTimeRef.current;
    
    // Latency is how much EARLIER the sound was heard than the tap
    // Or how much LATER the tap was than the sound.
    // Usually, if you tap "on the beat", your tap is slightly late due to reaction time + system latency.
    // We want to measure the system latency.
    
    setResult(Math.round(diff));
    setStep('finished');
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const applyResult = () => {
    if (result !== null) {
      // Clamp to 0-1000
      const final = Math.max(0, Math.min(1000, result));
      setGlobalLatencyMs(final);
      onClose();
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="p-6 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center mb-4">
            <Zap className="w-6 h-6 text-indigo-400" />
          </div>
          <h2 className="text-xl font-bold mb-2">Manual Calibration</h2>
          <p className="text-sm text-zinc-400 mb-8">
            Tap the button exactly on the 5th beat to measure your system's latency.
          </p>

          {step === 'idle' && (
            <button 
              onClick={startCalibration}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all active:scale-95"
            >
              Start (4 Beats)
            </button>
          )}

          {step === 'counting' && (
            <div className="w-full space-y-8">
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div 
                    key={i}
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all",
                      count >= i ? "bg-indigo-500 text-white scale-110" : "bg-zinc-800 text-zinc-600"
                    )}
                  >
                    {i}
                  </div>
                ))}
              </div>
              <button 
                onPointerDown={handleTap}
                className="w-full py-12 bg-white text-zinc-900 text-2xl font-black rounded-2xl shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-90 transition-transform uppercase tracking-tighter"
              >
                TAP NOW!
              </button>
            </div>
          )}

          {step === 'finished' && (
            <div className="w-full space-y-6">
              <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
                <span className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Measured Latency</span>
                <div className="text-4xl font-mono font-bold text-emerald-400 mt-1">{result}ms</div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setStep('idle')}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-xl transition-all"
                >
                  Retry
                </button>
                <button 
                  onClick={applyResult}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
        
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-zinc-300"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
