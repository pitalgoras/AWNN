import { useState, useEffect, useCallback } from 'react';

const PIXELS_PER_INCH = 96;
const SMALL_SCREEN_INCHES = 6.7;
const MEDIUM_SCREEN_INCHES = 10.7;

export type ScreenSize = 'small' | 'medium' | 'large';
export type Orientation = 'portrait' | 'landscape';
export type ToolbarType = 'horizontal' | 'vertical';

interface ToolbarContextValue {
  screenSize: ScreenSize;
  orientation: Orientation;
  toolbarType: ToolbarType;
  isPortrait: boolean;
  isLandscape: boolean;
  screenWidthInches: number;
}

export function useToolbarContext(toolbarType: ToolbarType): ToolbarContextValue {
  const [context, setContext] = useState<ToolbarContextValue>(() => {
    const width = window.innerWidth;
    const inches = width / PIXELS_PER_INCH;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;

    return {
      screenSize: getScreenSize(inches),
      orientation: isPortrait ? 'portrait' : 'landscape',
      toolbarType,
      isPortrait,
      isLandscape: !isPortrait,
      screenWidthInches: inches,
    };
  });

  const updateContext = useCallback(() => {
    const width = window.innerWidth;
    const inches = width / PIXELS_PER_INCH;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;

    setContext({
      screenSize: getScreenSize(inches),
      orientation: isPortrait ? 'portrait' : 'landscape',
      toolbarType,
      isPortrait,
      isLandscape: !isPortrait,
      screenWidthInches: inches,
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

function getScreenSize(inches: number): ScreenSize {
  if (inches < SMALL_SCREEN_INCHES) return 'small';
  if (inches <= MEDIUM_SCREEN_INCHES) return 'medium';
  return 'large';
}
