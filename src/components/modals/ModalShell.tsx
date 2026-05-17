import React from 'react';
import { X } from 'lucide-react';

interface Props {
  show: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  singleColumn?: boolean;
}

export const ModalLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-sm text-zinc-400">{children}</span>
);

export const ModalHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">{children}</label>
);

export const ModalRow: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex items-center justify-between gap-4 ${className}`}>{children}</div>
);

export const ModalCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-zinc-800/50 border border-zinc-800 rounded-xl p-2 ${className}`}>
    {children}
  </div>
);

export const ModalShell: React.FC<Props> = ({ show, onClose, title, children, maxWidth = 'max-w-sm', singleColumn = false }) => {
  if (!show) return null;
  const desktopWidth = maxWidth.startsWith('max-w-') ? maxWidth.replace('max-w-', 'sm:max-w-') : `sm:${maxWidth}`;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center sm:p-6 p-4" onClick={onClose}>
      <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-y-auto max-h-[93vh] max-w-[calc(100vw-2rem)] ${desktopWidth}`} onClick={e => e.stopPropagation()}>
        <div className="pt-4 sm:pt-5 pb-2 px-4 sm:px-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center shrink-0">
          <h2 className="text-base sm:text-lg font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors hover:text-white text-zinc-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className={singleColumn ? "pt-2 sm:pt-3 pb-4 sm:pb-6 px-4 sm:px-6" : "sm:columns-2 sm:gap-12 sm:[column-rule:1px_solid_rgb(39_39_42)] [&>*]:break-inside-avoid [&>*]:mb-3 pt-2 sm:pt-3 pb-4 sm:pb-6 px-4 sm:px-6"}>
          {children}
        </div>
      </div>
    </div>
  );
};
