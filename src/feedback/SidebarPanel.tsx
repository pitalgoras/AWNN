import type { ReactNode } from 'react';

interface SidebarPanelProps {
  show: boolean;
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}

export function SidebarPanel({ show, title, headerRight, children }: SidebarPanelProps) {
  if (!show) return null;

  return (
    <aside className="w-64 border-l border-zinc-800 bg-zinc-900/30 flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
      <div className="p-3 border-b border-zinc-800 sticky top-0 bg-zinc-900/90 backdrop-blur-sm z-10 flex justify-between items-center">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          {title}
        </span>
        {headerRight && <div className="flex items-center gap-1">{headerRight}</div>}
      </div>
      {children}
    </aside>
  );
}
