import React from 'react';
import { Loader2 } from 'lucide-react';

// Non-dismissable full-screen loading indicator. Used for long song imports —
// native dialogs are invisible in fullscreen, and the import is already
// committed to, so there is nothing to cancel anyway.
export const LoadingOverlay: React.FC<{ show: boolean; label?: string }> = ({ show, label }) => {
  if (!show) return null;
  return (
    <div
      className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-[110] flex flex-col items-center justify-center gap-3"
      onClick={e => e.stopPropagation()}
    >
      <Loader2 size={28} className="animate-spin text-zinc-400" />
      <p className="text-xs text-zinc-400">{label || 'Loading…'}</p>
    </div>
  );
};
