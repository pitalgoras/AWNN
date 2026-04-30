import React, { useEffect, useState } from 'react';
import { perfLogger } from '../utils/PerformanceLogger';
import { Activity, Download } from 'lucide-react';

export function StatusLogger() {
  const [status, setStatus] = useState("Idle");

  useEffect(() => {
    return perfLogger.subscribe(setStatus);
  }, []);

  return (
    <div className="fixed bottom-0 right-0 z-[9999] m-2 flex items-center gap-2 bg-zinc-900/90 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1 rounded shadow-lg backdrop-blur-sm pointer-events-auto">
      <Activity className={`w-3 h-3 ${status !== "Idle" ? "text-emerald-500 animate-pulse" : "text-zinc-500"}`} />
      <span className="min-w-[200px] truncate">{status}</span>
      <button 
        onClick={() => perfLogger.downloadLog()}
        className="ml-2 p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-100 transition-colors"
        title="Download Diagnostic Log"
      >
        <Download className="w-3 h-3" />
      </button>
    </div>
  );
}
