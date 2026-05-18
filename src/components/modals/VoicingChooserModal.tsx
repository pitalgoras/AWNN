import React, { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { ModalShell } from './ModalShell';
import { cn, getShortLabel, getContrastColor } from '../../lib/utils';

interface Props { show: boolean; onClose: () => void }

function blendColors(hex1: string, hex2: string): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return '#' + [r1, g1, b1].map((_, i) =>
    Math.floor(([r1, g1, b1][i] + [r2, g2, b2][i]) / 2).toString(16).padStart(2, '0')
  ).join('');
}

export const VoicingChooserModal: React.FC<Props> = ({ show, onClose }) => {
  const tracks = useStore(s => s.tracks);
  const addCustomTag = useStore(s => s.addCustomTag);
  const comboTagSeparator = useStore(s => s.comboTagSeparator);

  const voiceTracks = useMemo(
    () => (tracks || []).filter(t => t.id !== 'metronome' && !t.isInstrument),
    [tracks]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleVoice = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selected = useMemo(
    () => voiceTracks.filter(t => selectedIds.has(t.id)),
    [voiceTracks, selectedIds]
  );

  const previewColor = useMemo(() => {
    if (selected.length === 0) return '#3b82f6';
    return selected.reduce((acc, t) => blendColors(acc, t.color), selected[0].color);
  }, [selected]);

  const previewLabel = useMemo(() => {
    if (selected.length === 0) return 'Select voices';
    return selected.map(t => getShortLabel(t.name, 1)).join(comboTagSeparator);
  }, [selected, comboTagSeparator]);

  const previewId = useMemo(() => {
    if (selected.length < 2) return '';
    return `combo-${selected.map(t => t.id).sort().join('-')}`;
  }, [selected]);

  const canAdd = selected.length >= 2;

  const handleAdd = () => {
    if (!canAdd) return;
    addCustomTag({
      id: previewId,
      label: previewLabel,
      color: previewColor,
      trackIds: selected.map(t => t.id),
      isComposite: true,
    });
    setSelectedIds(new Set());
    onClose();
  };

  return (
    <ModalShell show={show} onClose={onClose} title="Create Combination" singleColumn maxWidth="max-w-xs">
      <div className="space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Select voices</div>
        <div className="flex flex-wrap gap-2">
          {voiceTracks.map(t => {
            const isSelected = selectedIds.has(t.id);
            return (
              <button key={t.id}
                onClick={() => toggleVoice(t.id)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold transition-all border",
                  isSelected
                    ? "ring-2 ring-white scale-105 border-transparent"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                )}
                style={isSelected ? { backgroundColor: t.color, color: getContrastColor(t.color) } : {}}
              >
                {getShortLabel(t.name, 3)}
              </button>
            );
          })}
        </div>

        {selected.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Preview</div>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs"
                style={{ backgroundColor: previewColor, color: getContrastColor(previewColor) }}
              >
                {previewLabel}
              </div>
              <span className="text-xs text-zinc-400">{previewLabel}</span>
            </div>
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className={cn(
            "w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all",
            canAdd
              ? "bg-blue-600 hover:bg-blue-500 text-white"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          )}
        >
          Add Combination
        </button>
      </div>
    </ModalShell>
  );
};
