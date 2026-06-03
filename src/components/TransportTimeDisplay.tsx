import React from 'react';
import { useStore } from '../store/useStore';
import { formatTime, formatBarBeat } from '../audio/time/timeFormat';

export function TransportTimeDisplay() {
  const currentTime = useStore((state) => state.currentTime);
  const duration = useStore((state) => state.duration);
  const bpm = useStore((state) => state.bpm);
  const timeSignature = useStore((state) => state.timeSignature);

  const barBeatStr = formatBarBeat(currentTime, bpm, timeSignature);
  const match = barBeatStr.match(/^Bar\s+(\d+)\s+Beat\s+(\d+)$/);
  const barNum = match?.[1] ?? barBeatStr;
  const beatNum = match?.[2] ?? '';

  return (
    <div className="flex flex-col justify-center">
      <div className="font-mono text-xl font-light tracking-wider text-zinc-100 leading-none">
        {formatTime(currentTime)}
      </div>
      <div className="font-mono text-xl font-light tracking-wider text-zinc-100 leading-none flex items-center gap-2">
        <span className="flex items-baseline gap-1">
          <span className="text-[13px] text-zinc-400">Bar</span>
          <span>{barNum}</span>
        </span>
        {beatNum && (
          <span className="flex items-baseline gap-1">
            <span className="text-[13px] text-zinc-400">Beat</span>
            <span>{beatNum}</span>
          </span>
        )}
      </div>
    </div>
  );
}
