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
  const sectionTags = useStore(s => s.sectionTags);
  const setSectionTags = useStore(s => s.setSectionTags);

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

      {/* Section Tags */}
      <div>
        <ModalHeading>Section Tags</ModalHeading>
        <p className="text-[10px] text-zinc-500 mb-2">Markers inserted as [Name] in lyrics, rendered as styled headers in display mode.</p>
        <div className="flex flex-col gap-1.5">
          {sectionTags.map((tag, i) => (
            <ModalRow key={i}>
              <input type="text" value={tag}
                onChange={(e) => {
                  const next = [...sectionTags];
                  next[i] = e.target.value;
                  setSectionTags(next);
                }}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
              />
              <button onClick={() => setSectionTags(sectionTags.filter((_, j) => j !== i))}
                className="px-2 py-1 text-[10px] text-red-400 hover:text-red-300 font-bold"
              >
                Remove
              </button>
            </ModalRow>
          ))}
        </div>
        <button onClick={() => setSectionTags([...sectionTags, ''])}
          className="mt-2 w-full h-8 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wider transition-all"
        >
          + Add Tag
        </button>
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
