import { useState, useEffect, useCallback } from 'react';

// Modern approach: Use CSS pixel breakpoints, not inches
// CSS pixels are already DPR-agnostic (browser handles high-DPI scaling)
const SMALL_SCREEN_PX = 768;   // < 768px = small (mobile/tablet)
const MEDIUM_SCREEN_PX = 1280; // 768-1280px = medium (laptop/tablet landscape)

export type ScreenSize = 'small' | 'medium' | 'large';
export type Orientation = 'portrait' | 'landscape';
export type ToolbarType = 'horizontal' | 'vertical';

interface ToolbarContextValue {
  screenSize: ScreenSize;
  orientation: Orientation;
  toolbarType: ToolbarType;
  isPortrait: boolean;
  isLandscape: boolean;
}

export function useToolbarContext(toolbarType: ToolbarType): ToolbarContextValue {
  const [context, setContext] = useState<ToolbarContextValue>(() => {
    const width = window.innerWidth;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;
    
    return {
      screenSize: getScreenSize(width),
      orientation: isPortrait ? 'portrait' : 'landscape',
      toolbarType,
      isPortrait,
      isLandscape: !isPortrait,
    };
  });

  const updateContext = useCallback(() => {
    const width = window.innerWidth;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;
    
    setContext({
      screenSize: getScreenSize(width),
      orientation: isPortrait ? 'portrait' : 'landscape',
      toolbarType,
      isPortrait,
      isLandscape: !isPortrait,
    });
  }, [toolbarType]);

  useEffect(() => {
    window.addEventListener('resize', updateContext);
    window.addEventListener('orientationchange', updateContext);
    return () => {
      window.removeEventListener('resize', updateContext);
      window.removeEventListener('orientationchange', updateContext);
    };
  }, [updateContext]);

  return context;
}

function getScreenSize(widthPx: number): ScreenSize {
  if (widthPx < SMALL_SCREEN_PX) return 'small';
  if (widthPx <= MEDIUM_SCREEN_PX) return 'medium';
  return 'large';
}
