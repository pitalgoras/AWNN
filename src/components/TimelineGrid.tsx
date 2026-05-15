import React from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

export const TimelineGrid: React.FC = () => {
  const { bpm, timeSignature, zoom, duration, barLinesEnabled } = useStore();
  const scrollLeftRef = React.useRef(0);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [renderTick, setRenderTick] = React.useState(0);

  React.useEffect(() => {
    let container: HTMLElement | null = document.querySelector('.multitrack-scroll-container');
    let rafId = 0;

    const handleScroll = () => {
      if (!container) return;
      scrollLeftRef.current = container.scrollLeft;
      if (gridRef.current) {
        gridRef.current.style.transform = `translateX(-${scrollLeftRef.current}px)`;
      }
      // Throttle virtualization update to ~50ms via rAF
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setRenderTick(t => t + 1);
      });
    };

    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();
    }

    const observer = new MutationObserver(() => {
      const newContainer = document.querySelector('.multitrack-scroll-container');
      if (newContainer && newContainer !== container) {
        if (container) container.removeEventListener('scroll', handleScroll);
        container = newContainer as HTMLElement;
        container.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
      }
    });

    const rootContainer = document.querySelector('.multitrack-container');
    if (rootContainer) observer.observe(rootContainer, { childList: true });

    return () => {
      cancelAnimationFrame(rafId);
      if (container) container.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [zoom]);

  const beatsPerSecond = (bpm || 120) / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const beatsPerBar = timeSignature?.[0] || 4;
  const secondsPerBar = secondsPerBeat * beatsPerBar;
  const pixelsPerBar = secondsPerBar * zoom;
  const pixelsPerBeat = secondsPerBeat * zoom;
  const totalBars = Math.ceil((Math.max(duration, 0) + 600) / secondsPerBar) + 1;

  // Virtualization: only render visible bars
  const sl = scrollLeftRef.current;
  const viewportWidth = window.innerWidth;
  const startBar = Math.max(0, Math.floor(sl / pixelsPerBar) - 1);
  const endBar = Math.min(totalBars, Math.ceil((sl + viewportWidth) / pixelsPerBar) + 1);
  const visibleBars = Array.from({ length: endBar - startBar }, (_, i) => startBar + i);

  // Force re-render for virtualization when tick changes
  void renderTick;

  if (barLinesEnabled === 'none') return null;

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-30 overflow-hidden">
      <div
        ref={gridRef}
        className="relative h-full"
        style={{ width: `${totalBars * pixelsPerBar}px` }}
      >
        {visibleBars.map((i) => {
          const left = i * pixelsPerBar;
          const isPre = i === 0;
          const barNumber = i;

          return (
            <React.Fragment key={i}>
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

              {barLinesEnabled === 'bars-beats' && Array.from({ length: beatsPerBar - 1 }).map((_, j) => (
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
