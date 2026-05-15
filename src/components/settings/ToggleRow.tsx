import React from 'react';
import { cn } from '../../lib/utils';

interface Props {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  useGreen?: boolean;
}

export const ToggleRow: React.FC<Props> = ({ label, enabled, onToggle, useGreen }) => {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-400">{label}</span>
      <button
        onClick={onToggle}
        className={cn(
          "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
          enabled
            ? useGreen
              ? "bg-emerald-600 text-white"
              : "bg-zinc-700 text-zinc-300"
            : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
        )}
      >
        {enabled ? 'On' : 'Off'}
      </button>
    </div>
  );
};
