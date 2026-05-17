import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Upload } from 'lucide-react';
import { autoMatchFileToTrack, decodeAudioFile, trackNameFromFile } from '../../audio/import/importUtils';
import { TrackListEditor } from '../settings/TrackListEditor';
import { calculatePeaksAsync } from '../../audio/processing/audioUtils';
import { ModalShell } from './ModalShell';

interface Props { show: boolean; onClose: () => void; files: File[] }

export const ImportAudioModal: React.FC<Props> = ({ show, onClose, files }) => {
  const tracks = useStore(s => s.tracks);
  const addTrack = useStore(s => s.addTrack);
  const addPhrase = useStore(s => s.addPhrase);
  const currentTime = useStore(s => s.currentTime);
  const audioContextRef = React.useRef<AudioContext | null>(null);

  const [mapping, setMapping] = useState<Map<number, string>>(new Map());
  const [importing, setImporting] = useState(false);
  const [importIndex, setImportIndex] = useState(0);

  useEffect(() => {
    if (!show) return;
    const map = new Map<number, string>();
    const trackNames = tracks.filter(t => t.id !== 'metronome').map(t => ({ id: t.id, name: t.name }));
    files.forEach((f, i) => {
      const match = autoMatchFileToTrack(f.name, trackNames);
      map.set(i, match ?? '__new__');
    });
    setMapping(map);
  }, [show, files, tracks]);

  const nonMetroTracks = tracks;

  const runImport = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const ctx = audioContextRef.current;
    setImporting(true);

    for (let i = 0; i < files.length; i++) {
      setImportIndex(i + 1);
      const file = files[i];
      let targetId = mapping.get(i);

      if (targetId === '__new__') {
        const name = trackNameFromFile(file);
        addTrack({ name, color: '#3b82f6', isMuted: false, isSolo: false, volume: 0.8, pan: 0, offset: 0, phrases: [], envelope: [] });
        const updatedTracks = useStore.getState().tracks.filter(t => t.id !== 'metronome');
        targetId = updatedTracks[updatedTracks.length - 1]?.id;
        if (!targetId) continue;
      } else if (!targetId) {
        continue;
      }

      try {
        const audioBuffer = await decodeAudioFile(file, ctx);
        const peaks = await calculatePeaksAsync(audioBuffer);
        const url = URL.createObjectURL(file);

        addPhrase(targetId, {
          url, audioBuffer, peaks, blob: file,
          startPosition: currentTime,
          duration: audioBuffer.duration,
          headLength: 0, anchoredFrame: 0,
          originalAnchoredFrame: 0, createdAt: Date.now(),
        });
      } catch (err) {
        console.error('Failed to import', file.name, err);
      }
    }

    setImporting(false);
    onClose();
  };

  const unassignedCount = files.filter((_, i) => mapping.get(i) === '__new__').length;
  const assignedCount = files.filter((_, i) => mapping.get(i) && mapping.get(i) !== '__new__').length;

  return (
    <ModalShell show={show} onClose={onClose} title="Import Audio Tracks" maxWidth="max-w-2xl" singleColumn>
      <div className="space-y-6">
          {/* File list with assignment dropdowns */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">Files to import ({files.length})</label>
            <div className="space-y-2">
              {files.map((file, i) => (
                <div key={i} className="flex items-center gap-3 bg-zinc-800/30 rounded-lg p-3">
                  <span className="text-xs text-zinc-500 w-6">{i + 1}.</span>
                  <span className="text-sm text-zinc-200 flex-1 truncate">{file.name}</span>
                  <select
                    value={mapping.get(i) ?? '__new__'}
                    onChange={(e) => { const m = new Map(mapping); m.set(i, e.target.value); setMapping(m); }}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                    disabled={importing}
                  >
                    {nonMetroTracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="__new__">(New track)</option>
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-zinc-500">
              {assignedCount > 0 && <span>{assignedCount} matched</span>}
              {unassignedCount > 0 && <span>{assignedCount > 0 ? ' · ' : ''}{unassignedCount} will create new tracks</span>}
            </div>
          </div>

          {/* Track management */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">Tracks</label>
            <TrackListEditor />
          </div>

          {/* Import button */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} disabled={importing} className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50">
              Cancel
            </button>
            <button onClick={runImport} disabled={importing} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              <Upload size={14} />
              {importing ? `Importing ${importIndex}/${files.length}...` : `Import ${files.length} files`}
            </button>
          </div>
        </div>
    </ModalShell>
  );
};
