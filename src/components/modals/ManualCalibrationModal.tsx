import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { ModalShell } from './ModalShell';

interface ManualCalibrationModalProps {
  show: boolean;
  onClose: () => void;
}

export const ManualCalibrationModal: React.FC<ManualCalibrationModalProps> = ({ show, onClose }) => {
  const { globalLatencyMs, setGlobalLatencyMs } = useStore();
  const [localLatency, setLocalLatency] = useState(globalLatencyMs);

  const applyResult = () => {
    setGlobalLatencyMs(localLatency);
    onClose();
  };

  return (
    <ModalShell show={show} onClose={onClose} title="Latency Loopback Test" singleColumn maxWidth="max-w-md">
      <div className="space-y-3 text-xs text-zinc-300 leading-snug">
        <h3 className="text-white font-bold tracking-tight">Step-by-Step Protocol</h3>
        {[
          'Turn UP your computer speakers. Do NOT proceed with headphones on.',
          'Add a new audio track and Enable Record Mode (Click the mic icon).',
          'Ensure the Metronome is Unmuted and you are at Bar 1.',
          'Press Record. Record the click bleed. Stop when done.',
          'Using the slider, zoom entirely in on the recorded waveform. Adjust the slider below until the transient peaks visually align exactly with the vertical grid lines.',
        ].map((step, i) => (
          <div key={i} className="flex gap-2.5">
            <div className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] flex items-center justify-center shrink-0">{i + 1}</div>
            <p>{step}</p>
          </div>
        ))}
      </div>

      <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Global Latency Offset</span>
          <div className="text-lg font-mono font-bold text-indigo-400">{localLatency} ms</div>
        </div>
        <input
          type="range" min="-500" max="500" step="1" value={localLatency}
          onChange={(e) => { setLocalLatency(parseInt(e.target.value)); setGlobalLatencyMs(parseInt(e.target.value)); }}
          className="w-full h-1.5 bg-zinc-900 rounded-full appearance-none cursor-pointer accent-indigo-500 mb-1.5"
        />
        <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
          <span>-500ms</span><span>0</span><span>+500ms</span>
        </div>
      </div>

      <button onClick={applyResult} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all">
        Done
      </button>
    </ModalShell>
  );
};
