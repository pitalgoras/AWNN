import React, { useState, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { Plus, ArrowUp, ArrowDown, Settings, Trash2 } from 'lucide-react';
import { ModalCard } from '../modals/ModalShell';
import { getTrackInitials, getTrackShortLabel } from '../../lib/utils';

export const TrackListEditor: React.FC<{ onEditTrack?: (id: string) => void; flat?: boolean }> = ({ onEditTrack, flat = false }) => {
  const tracks = useStore(s => s.tracks);
  const addTrack = useStore(s => s.addTrack);
  const updateTrack = useStore(s => s.updateTrack);
  const removeTrack = useStore(s => s.removeTrack);
  const reorderTracks = useStore(s => s.reorderTracks);

  const [pendingLabelId, setPendingLabelId] = useState<string | null>(null);
  const pendingInputRef = useRef<HTMLInputElement>(null);

  const visibleTracks = (tracks || []).filter(t => t.id !== 'metronome');

  const existingLabels = (tracks || [])
    .filter(t => t.id !== 'metronome')
    .map(t => getTrackShortLabel(t, 3));

  const content = (
    <>
      <button key="add" className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
        onClick={() => {
          const trackName = `Track ${visibleTracks.length + 1}`;
          addTrack({
            name: trackName,
            color: '#3b82f6',
            isMuted: false,
            isSolo: false,
            volume: 0.8,
            pan: 0,
            offset: 0,
            phrases: [],
            envelope: []
          });
          // Check for collision and resolve
          const initials = getTrackInitials(trackName, existingLabels);
          if (initials) {
            // Auto-set shortLabel to avoid collision
            const latest = useStore.getState().tracks.filter(t => t.id !== 'metronome').pop();
            if (latest) updateTrack(latest.id, { shortLabel: initials });
          } else {
            // All 1-3 letter options collide — prompt user
            const latest = useStore.getState().tracks.filter(t => t.id !== 'metronome').pop();
            if (latest) setPendingLabelId(latest.id);
          }
        }}
      >
        <Plus size={14} />
        Add New Track
      </button>

      {visibleTracks.map((track, index) => {
        const realIndex = tracks.indexOf(track);
        return (
        <React.Fragment key={track.id}>
          <ModalCard className="flex items-center gap-4">
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
              <div className="w-px h-4 bg-zinc-700 mx-0.5" />
              <span className="text-[10px] font-mono text-zinc-500 w-6 text-center">
                {getTrackShortLabel(track, 3)}
              </span>
              <div className="w-px h-4 bg-zinc-700 mx-0.5" />
              {onEditTrack && (
                <button onClick={() => onEditTrack(track.id)} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400">
                  <Settings size={14} />
                </button>
              )}
              <button onClick={() => {
                if (pendingLabelId === track.id) setPendingLabelId(null);
                removeTrack(track.id);
              }} className="p-1.5 hover:bg-zinc-700 rounded text-red-400/50 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          </ModalCard>
          {pendingLabelId === track.id && (
            <div className="px-4 pb-3 -mt-2">
              <div className="text-[10px] text-amber-400 mb-1.5">
                All 1–3 letter labels taken. Choose a unique label:
              </div>
              <input
                ref={pendingInputRef}
                autoFocus
                maxLength={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                placeholder="3-letter label"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                    if (val.length >= 1 && val.length <= 3) {
                      updateTrack(track.id, { shortLabel: val });
                      setPendingLabelId(null);
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = e.target.value.trim().toUpperCase();
                  if (val.length >= 1 && val.length <= 3) {
                    updateTrack(track.id, { shortLabel: val });
                  }
                  setPendingLabelId(null);
                }}
              />
            </div>
          )}
        </React.Fragment>
        );
      })}
    </>
  );

  return flat ? content : <div className="space-y-4">{content}</div>;
};
