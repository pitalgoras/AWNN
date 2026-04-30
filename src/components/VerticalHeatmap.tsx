import React, { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

interface VerticalHeatmapProps {
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

export const VerticalHeatmap: React.FC<VerticalHeatmapProps> = () => {
  const tracks = useStore(s => s.tracks);
  const duration = useStore(s => Math.max(s.duration || 60, 60));
  const getMultitrackTime = useStore(s => s.getMultitrackTime);
  const seekTo = useStore(s => s.seekTo);

  const vocalTracks = tracks.filter(t => t.id !== 'metronome');
  const PIXELS_PER_SECOND = 20;
  const playheadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame: number;
    const updatePlayhead = () => {
      if (playheadRef.current) {
        const time = getMultitrackTime();
        playheadRef.current.style.top = `${time * PIXELS_PER_SECOND}px`;
      }
      frame = requestAnimationFrame(updatePlayhead);
    };
    frame = requestAnimationFrame(updatePlayhead);
    return () => cancelAnimationFrame(frame);
  }, [getMultitrackTime]);

  const handleHeatmapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickedTime = y / PIXELS_PER_SECOND;
    if (seekTo) seekTo(clickedTime);
  };

  return (
    <div className="w-16 md:w-20 bg-zinc-950 border-r border-zinc-800 flex overflow-hidden shrink-0 relative select-none">
      <div 
        className="w-full relative cursor-pointer"
        style={{ height: `${duration * PIXELS_PER_SECOND}px` }}
        onPointerDown={handleHeatmapClick}
      >
        <div className="flex h-full w-full gap-[1px]">
          {vocalTracks.map(track => (
            <div key={track.id} className="flex-1 bg-zinc-900/40 relative">
              {track.phrases.map(phrase => {
                const height = phrase.duration * PIXELS_PER_SECOND;
                const top = phrase.startPosition * PIXELS_PER_SECOND;
                const hasPeaks = phrase.peaks && phrase.peaks.length > 0 && phrase.peaks[0] && phrase.peaks[0].length > 0;
                
                return (
                  <div 
                    key={phrase.id} 
                    className="absolute left-0 right-0 overflow-hidden"
                    style={{ 
                      top: `${top}px`, 
                      height: `${height}px`,
                      backgroundColor: `${track.color}15`,
                      borderLeft: `1px solid ${track.color}40`
                    }}
                  >
                    {hasPeaks && <PhrasePeakSVG peaks={phrase.peaks![0]} color={track.color} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div 
          ref={playheadRef}
          className="absolute left-0 right-0 h-[2px] bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)] z-30 pointer-events-none" 
        />
      </div>
    </div>
  );
};

const PhrasePeakSVG = React.memo(({ peaks, color }: { peaks: number[], color: string }) => {
  const pathData = React.useMemo(() => {
    // We want to draw a curve from top to bottom
    const numPoints = 100; // Fixed resolution vertically
    const itemsPerChunk = Math.max(1, Math.floor(peaks.length / numPoints));
    
    let leftSide = '';
    let rightSide = '';
    
    for (let i = 0; i < numPoints; i++) {
        let max = 0;
        let sum = 0;
        let count = 0;
        for (let j = 0; j < itemsPerChunk; j++) {
            const idx = i * itemsPerChunk + j;
            if (idx < peaks.length) {
                const val = Math.abs(peaks[idx]);
                max = Math.max(max, val);
                sum += val;
                count++;
            }
        }
        
        // Use a mix of RMS and Peak for a dense blocky shape, and contrast it
        const avg = count > 0 ? sum / count : 0;
        // Apply an envelope exponent for contrast, clamping
        const peakWidth = Math.min(100, Math.max(5, (max * 1.5 + avg) * 50)); 
        const currentY = (i / numPoints) * 100;
        
        const center = 50;
        const halfW = peakWidth / 2;
        
        // Create left coordinates moving down, and build right coordinates moving up backwards
        leftSide += `${i===0?'M':'L'} ${center - halfW} ${currentY} `;
        rightSide = `L ${center + halfW} ${currentY} ${rightSide}`;
    }
    
    return `${leftSide} ${rightSide} Z`;
  }, [peaks]);

  return (
    <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" className="opacity-80">
      <path d={pathData} fill={color} />
    </svg>
  );
});

