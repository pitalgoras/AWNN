import React from 'react';
import { ModalShell } from './ModalShell';

export interface ConfirmAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
}

interface ConfirmModalProps {
  show: boolean;
  title: string;
  message?: string;
  onClose: () => void;
  actions: ConfirmAction[];
}

const actionClass = (variant?: string) => {
  switch (variant) {
    case 'primary':
      return 'bg-emerald-800 hover:bg-emerald-700 text-zinc-100';
    case 'danger':
      return 'bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 border border-red-900/30';
    default:
      return 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300';
  }
};

// In-app replacement for window.confirm. Native dialogs do not render
// reliably while the app is in fullscreen, so every pre-action warning
// uses this instead.
export const ConfirmModal: React.FC<ConfirmModalProps> = ({ show, title, message, onClose, actions }) => (
  <ModalShell show={show} onClose={onClose} title={title} maxWidth="max-w-xs" singleColumn>
    {message && <p className="text-xs text-zinc-400 leading-relaxed mb-4 px-1">{message}</p>}
    <div className="space-y-1">
      {actions.map(action => (
        <button key={action.label} onClick={action.onClick}
          className={`w-full py-3 rounded-lg text-sm font-semibold transition-colors ${actionClass(action.variant)}`}>
          {action.label}
        </button>
      ))}
    </div>
  </ModalShell>
);
