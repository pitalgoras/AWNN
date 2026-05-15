import React from 'react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { Square, Volume2 } from 'lucide-react';

interface Props { show: boolean; onClose: () => void }

export const MetronomeModal: React.FC<Props> = ({ show, onClose }) => {
  const bpm = useStore(s => s.bpm);
  const timeSignature = useStore(s => s.timeSignature);
  const tracks = useStore(s => s.tracks);
  const setTimeSignature = useStore(s => s.setTimeSignature);
  const setBpm = useStore(s => s.setBpm);
  const metronomeEnabled = useStore(s => s.metronomeEnabled);
  const barLinesEnabled = useStore(s => s.barLinesEnabled);
  const metronomeTrackVisible = useStore(s => s.metronomeTrackVisible);
  const [pendingChange, setPendingChange] = React.useState<{ type: 'timeSignature'; value: [number, number] } | null>(null);

  if (!show) return null;

  const handleSigChange = (newVal: [number, number]) => {
    if ((tracks || []).some(t => t.id !== 'metronome' && t.phrases.length > 0)) {
      setPendingChange({ type: 'timeSignature', value: newVal });
    } else {
      setTimeSignature(newVal);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
          <h2 className="text-lg font-bold tracking-tight">Metronome & Grid</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
            <Square className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* BPM */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">BPM</label>
            <div className="flex items-center gap-3">
              <div className="text-4xl font-bold text-zinc-100 tabular-nums flex-1 leading-none">{bpm}</div>
              <div className="flex gap-1">
                <button onClick={() => setBpm(Math.max(40, bpm - 1))}
                  className="w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-lg font-bold flex items-center justify-center transition-colors"
                >−</button>
                <button onClick={() => setBpm(Math.min(250, bpm + 1))}
                  className="w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-lg font-bold flex items-center justify-center transition-colors"
                >+</button>
              </div>
            </div>
            <div className="mt-3">
              <input type="range" min="40" max="250" step="1" value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="w-full h-2 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-0.5">
                <span>40</span>
                <span>250</span>
              </div>
            </div>
          </div>

          {/* Time Signature */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">Time Signature</label>
            <div className="grid grid-cols-3 gap-2">
              {['4/4', '3/4', '2/4', '6/8', '12/8'].map((sig) => {
                const isActive = `${timeSignature?.[0] || 4}/${timeSignature?.[1] || 4}` === sig;
                return (
                  <button key={sig}
                    onClick={() => {
                      const parts = sig.split('/');
                      handleSigChange([Number(parts[0]), Number(parts[1])]);
                    }}
                    className={cn("py-3 rounded-xl text-sm font-mono transition-all border",
                      isActive
                        ? "bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                        : "bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                    )}
                  >{sig}</button>
                );
              })}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Metronome</span>
              <button onClick={() => useStore.getState().setMetronomeEnabled(!metronomeEnabled)}
                className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all", metronomeEnabled ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700")}>
                <Volume2 size={14} className="inline mr-1" />{metronomeEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Bar Lines</span>
              <button onClick={() => useStore.getState().setBarLinesEnabled(!barLinesEnabled)}
                className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all", barLinesEnabled ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700")}>
                {barLinesEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Track</span>
              <button onClick={() => useStore.getState().setMetronomeTrackVisible(!metronomeTrackVisible)}
                className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all", metronomeTrackVisible ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700")}>
                {metronomeTrackVisible ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
