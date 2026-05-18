import React from 'react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { Settings, Save, FolderOpen } from 'lucide-react';
import { ModalShell, ModalHeading, ModalRow, ModalLabel } from './ModalShell';
import { ToggleRow } from '../settings/ToggleRow';
import { exportProjectToJSON } from '../../audio/project/projectIO';

interface Props { show: boolean; onClose: () => void; onOpenAdvanced: () => void; onOpenTracks: () => void }

export const SettingsModal: React.FC<Props> = ({ show, onClose, onOpenAdvanced, onOpenTracks }) => {
  const globalLatencyMs = useStore(s => s.globalLatencyMs);
  const setGlobalLatencyMs = useStore(s => s.setGlobalLatencyMs);
  const metronomeEnabled = useStore(s => s.metronomeEnabled);
  const barLinesEnabled = useStore(s => s.barLinesEnabled);
  const saveProject = useStore(s => s.saveProject);
  const loadProject = useStore(s => s.loadProject);
  const comboTagSeparator = useStore(s => s.comboTagSeparator);
  const setComboTagSeparator = useStore(s => s.setComboTagSeparator);

  return (
    <ModalShell show={show} onClose={onClose} title="Settings" maxWidth="max-w-lg">
      {/* Latency Section */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <ModalHeading>Global Latency Offset</ModalHeading>
          <span className="font-mono text-[10px] text-zinc-400">{globalLatencyMs}ms</span>
        </div>
        <input type="range" min="-200" max="200" step="1" value={globalLatencyMs}
          onChange={(e) => setGlobalLatencyMs(parseInt(e.target.value))}
          className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      {/* Advanced Audio */}
      <div>
        <ModalHeading>Advanced Settings</ModalHeading>
        <button onClick={onOpenAdvanced} className="w-full h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
          <Settings size={14} /> Open Advanced Panel
        </button>
      </div>

      {/* Metronome */}
      <div>
        <ModalHeading>Metronome</ModalHeading>
        <div className="flex flex-col gap-2">
          <ToggleRow label="Metronome" enabled={metronomeEnabled} onToggle={() => useStore.getState().setMetronomeEnabled(!metronomeEnabled)} />
          <ModalRow>
            <ModalLabel>Grid Bar lines</ModalLabel>
            <button onClick={() => useStore.getState().cycleBarLines()}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                metronomeEnabled ? "bg-zinc-700 text-zinc-300" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
              )}
            >
              {barLinesEnabled === 'bars-beats' ? 'Bars + Beats' : barLinesEnabled === 'bars-only' ? 'Bars Only' : 'None'}
            </button>
          </ModalRow>
        </div>
      </div>

      {/* Combo Tag Separator */}
      <div>
        <ModalHeading>Combo Tag Separator</ModalHeading>
        <ModalRow>
          <ModalLabel>Separator character</ModalLabel>
          <button onClick={() => setComboTagSeparator(comboTagSeparator === '+' ? '&' : '+')}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
              "bg-zinc-700 text-zinc-300"
            )}
          >
            {comboTagSeparator}
          </button>
        </ModalRow>
      </div>

      {/* Track Management */}
      <div>
        <ModalHeading>Track Management</ModalHeading>
        <button onClick={onOpenTracks} className="w-full h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
          <Settings size={14} /> Manage Tracks
        </button>
      </div>

      {/* Project Actions */}
      <div>
        <ModalHeading>Project Actions</ModalHeading>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={saveProject} className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
            <Save size={14} /> Save Project
          </button>
          <button onClick={loadProject} className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
            <FolderOpen size={14} /> Load Project
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
