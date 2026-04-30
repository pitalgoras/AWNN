import { useState, useEffect, useCallback, useRef } from 'react';
import type { ToolbarType } from './useToolbarContext';

const ABBREVIATION_THRESHOLD_INCHES = 0.8;

interface UseAdaptiveLabelsReturn {
  isAbbreviated: boolean;
  getLabel: (full: string, abbreviated: string) => string;
}

export function useAdaptiveLabels(
  toolbarRef: React.RefObject<HTMLElement>,
  toolbarType: ToolbarType,
  itemCount: number
): UseAdaptiveLabelsReturn {
  const [isAbbreviated, setIsAbbreviated] = useState(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const checkSpace = useCallback(() => {
    const el = toolbarRef.current;
    if (!el) return;

    if (toolbarType === 'vertical') {
      // Vertical toolbar: check width
      const widthInches = el.offsetWidth / 96;
      setIsAbbreviated(widthInches < ABBREVIATION_THRESHOLD_INCHES);
    } else {
      // Horizontal toolbar: check available width per item
      const totalWidth = el.offsetWidth;
      const gap = 8; // approximate gap between items in pixels
      const totalGaps = (itemCount - 1) * gap;
      const availableWidthPerItem = (totalWidth - totalGaps) / itemCount;
      const inchesPerItem = availableWidthPerItem / 96;
      setIsAbbreviated(inchesPerItem < ABBREVIATION_THRESHOLD_INCHES);
    }
  }, [toolbarRef, toolbarType, itemCount]);

  useEffect(() => {
    checkSpace();

    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        checkSpace();
      });
    }

    const el = toolbarRef.current;
    if (el) {
      resizeObserverRef.current.observe(el);
    }

    return () => {
      if (resizeObserverRef.current && el) {
        resizeObserverRef.current.unobserve(el);
      }
    };
  }, [toolbarRef, checkSpace]);

  const getLabel = useCallback(
    (full: string, abbreviated: string) => {
      return isAbbreviated ? abbreviated : full;
    },
    [isAbbreviated]
  );

  return { isAbbreviated, getLabel };
}
