import React from 'react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { Plus, ChevronUp, ChevronDown, Settings, Trash2 } from 'lucide-react';

export const TrackListEditor: React.FC<{ onEditTrack?: (id: string) => void }> = ({ onEditTrack }) => {
  const tracks = useStore(s => s.tracks);
  const addTrack = useStore(s => s.addTrack);
  const updateTrack = useStore(s => s.updateTrack);
  const removeTrack = useStore(s => s.removeTrack);
  const reorderTracks = useStore(s => s.reorderTracks);

  return (
    <div className="space-y-4">
      <button
        onClick={() => {
          addTrack({
            name: `Track ${tracks.filter(t => t.id !== 'metronome').length + 1}`,
            color: '#3b82f6',
            isMuted: false,
            isSolo: false,
            volume: 0.8,
            pan: 0,
            offset: 0,
            phrases: [],
            envelope: []
          });
        }}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
      >
        <Plus size={14} />
        Add New Track
      </button>

      <div className="space-y-2">
        {(tracks || []).filter(t => t.id !== 'metronome').map((track, index) => {
          const nonMetronomeTracks = tracks.filter(t => t.id !== 'metronome');
          return (
            <div key={track.id} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
              <div className="relative group/color shrink-0">
                <div className="w-4 h-4 rounded-full shadow-inner border border-white/10" style={{ backgroundColor: track.color }} />
                <input
                  type="color"
                  value={track.color}
                  onChange={(e) => updateTrack(track.id, { color: e.target.value })}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </div>
              <div className="flex-1 min-w-0">
                <input
                  value={track.name}
                  onChange={(e) => updateTrack(track.id, { name: e.target.value })}
                  className="bg-transparent border-none focus:ring-0 text-sm font-bold text-zinc-100 p-0 w-full"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => reorderTracks(index, index - 1)}
                  disabled={index === 0}
                  className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 disabled:opacity-20"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => reorderTracks(index, index + 1)}
                  disabled={index === nonMetronomeTracks.length - 1}
                  className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 disabled:opacity-20"
                >
                  <ChevronDown size={14} />
                </button>
                {onEditTrack && (
                  <button onClick={() => onEditTrack(track.id)} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400">
                    <Settings size={14} />
                  </button>
                )}
                <button onClick={() => removeTrack(track.id)} className="p-1.5 hover:bg-zinc-700 rounded text-red-400/50 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
