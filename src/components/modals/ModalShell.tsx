import React from 'react';
import { Square } from 'lucide-react';

interface Props {
  show: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export const ModalShell: React.FC<Props> = ({ show, onClose, title, children, maxWidth = 'max-w-sm' }) => {
  if (!show) return null;
  const desktopWidth = maxWidth.startsWith('max-w-') ? maxWidth.replace('max-w-', 'sm:max-w-') : `sm:${maxWidth}`;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl w-full shadow-2xl overflow-y-auto max-h-[95vh] max-w-[calc(100vw-1rem)] ${desktopWidth}`} onClick={e => e.stopPropagation()}>
        <div className="p-4 sm:p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center shrink-0">
          <h2 className="text-base sm:text-lg font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
            <Square className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        <div className="p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
};
