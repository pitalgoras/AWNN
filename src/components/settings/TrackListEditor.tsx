import React from 'react';
import { useStore } from '../../store/useStore';
import { Plus, ArrowUp, ArrowDown, Settings, Trash2 } from 'lucide-react';
import { ModalCard } from '../modals/ModalShell';

export const TrackListEditor: React.FC<{ onEditTrack?: (id: string) => void; flat?: boolean }> = ({ onEditTrack, flat = false }) => {
  const tracks = useStore(s => s.tracks);
  const addTrack = useStore(s => s.addTrack);
  const updateTrack = useStore(s => s.updateTrack);
  const removeTrack = useStore(s => s.removeTrack);
  const reorderTracks = useStore(s => s.reorderTracks);

  const visibleTracks = (tracks || []).filter(t => t.id !== 'metronome');

  const content = (
    <>
        <button key="add" className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
        onClick={() => {
          addTrack({
            name: `Track ${visibleTracks.length + 1}`,
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
      >
        <Plus size={14} />
        Add New Track
      </button>

      {visibleTracks.map((track, index) => {
        const realIndex = tracks.indexOf(track);
        return (
        <ModalCard key={track.id} className="flex items-center gap-4">
          <div className="relative group/color shrink-0">
            <div className="w-4 h-4 rounded-full shadow-inner border border-white/10" style={{ backgroundColor: track.color }} />
            <input type="color" value={track.color}
              onChange={(e) => updateTrack(track.id, { color: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </div>
          <div className="flex-1 min-w-0">
            <input value={track.name}
              onChange={(e) => updateTrack(track.id, { name: e.target.value })}
              className="bg-transparent border-none focus:ring-0 text-sm font-bold text-zinc-100 p-0 w-full"
            />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => reorderTracks(realIndex, realIndex - 1)} disabled={index === 0}
              className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 disabled:opacity-20">
              <ArrowUp size={18} />
            </button>
            <button onClick={() => reorderTracks(realIndex, realIndex + 1)} disabled={index === visibleTracks.length - 1}
              className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 disabled:opacity-20">
              <ArrowDown size={18} />
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
        </ModalCard>
        );
      })}
    </>
  );

  return flat ? content : <div className="space-y-4">{content}</div>;
};
