import React from 'react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { Square, Settings, Volume2, Music, Save, FolderOpen } from 'lucide-react';
import { exportProjectToJSON } from '../../audio/project/projectIO';

interface Props { show: boolean; onClose: () => void; onOpenAdvanced: () => void; onOpenTracks: () => void }

export const SettingsModal: React.FC<Props> = ({ show, onClose, onOpenAdvanced, onOpenTracks }) => {
  const globalLatencyMs = useStore(s => s.globalLatencyMs);
  const setGlobalLatencyMs = useStore(s => s.setGlobalLatencyMs);
  const metronomeEnabled = useStore(s => s.metronomeEnabled);
  const barLinesEnabled = useStore(s => s.barLinesEnabled);
  const metronomeTrackVisible = useStore(s => s.metronomeTrackVisible);
  const saveProject = useStore(s => s.saveProject);
  const loadProject = useStore(s => s.loadProject);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-2" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl overflow-y-auto max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center sticky top-0 z-10">
          <h2 className="text-base font-bold tracking-tight">Settings</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
            <Square className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 min-[400px]:grid-cols-2 gap-x-4 gap-y-6">
          {/* Latency Section */}
          <div className="col-span-1 min-[400px]:col-span-2">
            <div className="flex justify-between items-center mb-3">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Global Latency Offset</label>
              <span className="font-mono text-[10px] text-zinc-400">{globalLatencyMs}ms</span>
            </div>
            <div className="space-y-3">
              <input type="range" min="-200" max="200" step="1" value={globalLatencyMs}
                onChange={(e) => setGlobalLatencyMs(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
            </div>
          </div>

          {/* Advanced Audio */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Advanced Settings</label>
            <button onClick={onOpenAdvanced} className="w-full h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
              <Settings size={14} />
              Open Advanced Panel
            </button>
          </div>

          {/* Metronome Section */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Metronome</label>
            <div className="flex flex-col gap-1.5">
              <button onClick={() => useStore.getState().setMetronomeEnabled(!metronomeEnabled)}
                className={cn("w-full h-9 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                  metronomeEnabled ? "bg-emerald-600 text-white shadow-sm" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
                )}>
                <Volume2 size={14} />{metronomeEnabled ? 'Enabled' : 'Disabled'}
              </button>
              <button onClick={() => useStore.getState().setBarLinesEnabled(!barLinesEnabled)}
                className={cn("w-full h-9 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                  barLinesEnabled ? "bg-emerald-600 text-white shadow-sm" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
                )}>
                Bar Lines
              </button>
              <button onClick={() => useStore.getState().setMetronomeTrackVisible(!metronomeTrackVisible)}
                className={cn("w-full h-9 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                  metronomeTrackVisible ? "bg-emerald-600 text-white shadow-sm" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
                )}>
                <Music size={14} />Track
              </button>
            </div>
          </div>

          {/* Track Management */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Track Mgmt</label>
            <button onClick={onOpenTracks} className="w-full h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
              <Settings size={14} />
              Manage Tracks
            </button>
          </div>

          {/* Project Actions */}
          <div className="col-span-1 min-[400px]:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Project Actions</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={saveProject} className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                <Save size={14} />Save Project
              </button>
              <button onClick={loadProject} className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                <FolderOpen size={14} />Load Project
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
