import React from 'react';
import { Square } from 'lucide-react';
import { TrackListEditor } from '../settings/TrackListEditor';

interface Props { show: boolean; onClose: () => void }

export const TrackManagerModal: React.FC<Props> = ({ show, onClose }) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center sticky top-0 z-10">
          <h2 className="text-lg font-bold tracking-tight">Manage Tracks</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
            <Square className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        <div className="p-6">
          <TrackListEditor />
        </div>
      </div>
    </div>
  );
};
