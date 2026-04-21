import React from 'react';
import { useStore } from '../store/useStore';

interface PlayheadSliderProps {
  seekTo: (time: number) => void;
}

export function PlayheadSlider({ seekTo }: PlayheadSliderProps) {
  const currentTime = useStore((state) => state.currentTime);
  const duration = useStore((state) => state.duration);

  return (
    <div className="w-full h-2 bg-zinc-900 border-b border-zinc-800 relative z-10 group shrink-0">
      <input
        type="range"
        min="0"
        max={duration || 1}
        step="0.01"
        value={Math.max(0, currentTime)}
        onChange={(e) => seekTo(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      <div 
        className="absolute top-0 bottom-0 bg-zinc-700/50 pointer-events-none"
        style={{ 
          width: `${(Math.max(0, currentTime) / (duration || 1)) * 100}%`,
          left: '0'
        }}
      />
      <div 
        className="absolute top-0 bottom-0 w-1 bg-red-500 pointer-events-none transition-transform group-hover:scale-x-150"
        style={{ 
          left: `${(Math.max(0, currentTime) / (duration || 1)) * 100}%`, 
          transform: 'translateX(-50%)' 
        }}
      />
    </div>
  );
}
