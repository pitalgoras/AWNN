import React from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

export const TimelineGrid: React.FC = () => {
  const { bpm, timeSignature, zoom, duration } = useStore();
  const [scrollLeft, setScrollLeft] = React.useState(0);

  React.useEffect(() => {
    let container = document.querySelector('.multitrack-scroll-container');
    
    const handleScroll = () => {
      if (container) {
        setScrollLeft(container.scrollLeft);
      }
    };

    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll();
    }

    // Observe for the container being created by Multitrack
    const observer = new MutationObserver(() => {
      const newContainer = document.querySelector('.multitrack-scroll-container');
      if (newContainer && newContainer !== container) {
        if (container) container.removeEventListener('scroll', handleScroll);
        container = newContainer;
        container.addEventListener('scroll', handleScroll);
        handleScroll();
      }
    });

    const rootContainer = document.querySelector('.multitrack-container');
    if (rootContainer) {
      observer.observe(rootContainer, { childList: true });
    }

    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [zoom]); // Re-bind if zoom changes, though container might be the same

  const beatsPerSecond = (bpm || 120) / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const beatsPerBar = timeSignature?.[0] || 4;
  const secondsPerBar = secondsPerBeat * beatsPerBar;
  
  const pixelsPerBar = secondsPerBar * zoom;
  const pixelsPerBeat = secondsPerBeat * zoom;
  
  // Render up to max duration + 10 minutes, plus 1 bar for pre-roll
  const totalBars = Math.ceil((Math.max(duration, 0) + 600) / secondsPerBar) + 1;
  
  // Virtualization: only render visible bars
  const viewportWidth = window.innerWidth; // Approximate
  const startBar = Math.max(0, Math.floor(scrollLeft / pixelsPerBar) - 1);
  const endBar = Math.min(totalBars, Math.ceil((scrollLeft + viewportWidth) / pixelsPerBar) + 1);
  
  const visibleBars = Array.from({ length: endBar - startBar }, (_, i) => startBar + i);

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-30 overflow-hidden">
      <div 
        className="relative h-full"
        style={{ 
          width: `${totalBars * pixelsPerBar}px`,
          transform: `translateX(-${scrollLeft}px)`
        }}
      >
        {visibleBars.map((i) => {
          const left = i * pixelsPerBar;
          // i=0 is the "Pre" bar
          // i=1 is Bar 1 (0:00:00)
          const isPre = i === 0;
          const barNumber = i; // i=1 is Bar 1
          
          return (
            <React.Fragment key={i}>
              {/* Bar Line */}
              <div 
                className={cn(
                  "absolute top-0 bottom-0 border-l",
                  isPre ? "border-zinc-700/50" : "border-zinc-500"
                )}
                style={{ left: `${left}px`, zIndex: 20 }}
              >
                <div className="absolute top-1 left-1 text-[10px] text-white font-bold font-mono select-none drop-shadow-md">
                  {isPre ? "PRE" : `${barNumber}.1`}
                </div>
              </div>
              
              {/* Beat Lines */}
              {Array.from({ length: beatsPerBar - 1 }).map((_, j) => (
                <div 
                key={`${i}-${j}`}
                className="absolute top-0 bottom-0 border-l border-zinc-600/50"
                style={{ left: `${left + (j + 1) * pixelsPerBeat}px`, zIndex: 20 }}
              >
                <div className="absolute top-1 left-1 text-[9px] text-zinc-200 font-semibold font-mono select-none drop-shadow-sm">
                  {isPre ? `PRE.${j + 2}` : `${barNumber}.${j + 2}`}
                </div>
              </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
