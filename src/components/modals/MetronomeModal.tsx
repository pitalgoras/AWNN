import React from 'react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { ModalShell } from './ModalShell';
import { ToggleRow } from '../settings/ToggleRow';

interface Props { show: boolean; onClose: () => void }

export const MetronomeModal: React.FC<Props> = ({ show, onClose }) => {
  const bpm = useStore(s => s.bpm);
  const timeSignature = useStore(s => s.timeSignature);
  const tracks = useStore(s => s.tracks);
  const setTimeSignature = useStore(s => s.setTimeSignature);
  const setBpm = useStore(s => s.setBpm);
  const metronomeEnabled = useStore(s => s.metronomeEnabled);
  const barLinesEnabled = useStore(s => s.barLinesEnabled);
  const [pendingChange, setPendingChange] = React.useState<{ type: 'timeSignature'; value: [number, number] } | null>(null);

  const handleSigChange = (newVal: [number, number]) => {
    if ((tracks || []).some(t => t.id !== 'metronome' && t.phrases.length > 0)) {
      setPendingChange({ type: 'timeSignature', value: newVal });
    } else {
      setTimeSignature(newVal);
    }
  };

  return (
    <ModalShell show={show} onClose={onClose} title="Tempo and Time Signature">
      <div className="space-y-8">
      {/* BPM */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">BPM</label>
        <div className="relative flex items-center justify-center min-h-[44px]">
          <div className="text-4xl font-bold text-zinc-100 tabular-nums leading-none">{bpm}</div>
          <div className="absolute right-0 flex gap-1">
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
                onClick={() => { const parts = sig.split('/'); handleSigChange([Number(parts[0]), Number(parts[1])]); }}
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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Bar Lines</span>
          <button onClick={() => useStore.getState().cycleBarLines()}
            className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
          >
            {barLinesEnabled === 'bars-beats' ? 'Bars + Beats' : barLinesEnabled === 'bars-only' ? 'Bars Only' : 'None'}
          </button>
        </div>
        <ToggleRow label="Metronome" enabled={metronomeEnabled} onToggle={() => useStore.getState().setMetronomeEnabled(!metronomeEnabled)} />
      </div>
      </div>
    </ModalShell>
  );
};
