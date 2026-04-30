import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { X, Sliders } from 'lucide-react';

interface ManualCalibrationModalProps {
  onClose: () => void;
}

export const ManualCalibrationModal: React.FC<ManualCalibrationModalProps> = ({ onClose }) => {
  const { globalLatencyMs, setGlobalLatencyMs } = useStore();
  const [localLatency, setLocalLatency] = useState(globalLatencyMs);

  const applyResult = () => {
    setGlobalLatencyMs(localLatency);
    onClose();
  };

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex p-2 w-full max-w-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col opacity-95 hover:opacity-100 transition-opacity">
        <div className="p-3 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
             <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center">
              <Sliders className="w-3 h-3 text-indigo-400" />
            </div>
            <h2 className="text-sm font-bold">Latency Loopback Test</h2>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 flex flex-col space-y-4 text-xs text-zinc-300 leading-snug cursor-default">
          <h3 className="text-white font-bold tracking-tight mb-2">Step-by-Step Protocol</h3>
          <div className="grid grid-cols-1 gap-y-3">
            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] flex items-center justify-center shrink-0">1</div>
              <p>Turn <strong className="text-white">UP</strong> your computer speakers. Do NOT proceed with headphones on.</p>
            </div>
            
            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] flex items-center justify-center shrink-0">2</div>
              <p>Add a new audio track and <strong className="text-white">Enable Record Mode</strong> (Click the mic icon).</p>
            </div>

            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] flex items-center justify-center shrink-0">3</div>
              <p>Ensure the <strong className="text-white">Metronome is Unmuted</strong> and you are at Bar 1.</p>
            </div>

            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] flex items-center justify-center shrink-0">4</div>
              <p>Press <strong className="text-white">Record</strong>. Record the click bleed. Stop when done.</p>
            </div>

            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] flex items-center justify-center shrink-0">5</div>
              <p>Using the slider in the timeline, <strong className="text-white">zoom entirely in</strong> on the recorded waveform. Adjust the slider below until the transient peaks visually align exactly with the vertical grid lines representing the beats.</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
             <div className="flex justify-between items-center mb-2">
               <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Global Latency Offset</span>
               <div className="text-lg font-mono font-bold text-indigo-400">{localLatency} ms</div>
             </div>
             
             <input 
                type="range" 
                min="-500" max="500" step="1" 
                value={localLatency}
                onChange={(e) => {
                  setLocalLatency(parseInt(e.target.value));
                  setGlobalLatencyMs(parseInt(e.target.value)); 
                }}
                className="w-full h-1.5 bg-zinc-900 rounded-full appearance-none cursor-pointer accent-indigo-500 mb-1.5"
              />
              <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                <span>-500ms</span>
                <span>0</span>
                <span>+500ms</span>
              </div>
          </div>
        </div>

        <div className="p-3 bg-zinc-900/80 border-t border-zinc-800 shrink-0">
          <button 
            onClick={applyResult}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
