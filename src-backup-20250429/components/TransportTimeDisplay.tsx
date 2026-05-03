import React from 'react';
import { useStore } from '../store/useStore';
import { formatTime, formatBarBeat } from '../utils/timeFormat';

export function TransportTimeDisplay() {
  const currentTime = useStore((state) => state.currentTime);
  const duration = useStore((state) => state.duration);
  const bpm = useStore((state) => state.bpm);
  const timeSignature = useStore((state) => state.timeSignature);

  return (
    <div className="flex flex-col justify-center">
      <div className="flex items-center gap-3">
        <div className="font-mono text-xl font-light tracking-wider text-zinc-100 leading-none">
          {formatTime(currentTime)}
        </div>
        <div className="font-mono text-[10px] text-zinc-500 tracking-widest leading-none border-l border-zinc-800 pl-3">
          {formatTime(duration)}
        </div>
      </div>
      <div className="font-mono text-[9px] text-zinc-400 tracking-widest mt-0.5 uppercase opacity-70">
        {formatBarBeat(currentTime, bpm, timeSignature)}
      </div>
    </div>
  );
}
