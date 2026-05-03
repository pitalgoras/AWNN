import { useState, useEffect, useCallback, useRef } from 'react';
import type { ToolbarType } from './useToolbarContext';

// CSS pixel thresholds (replace inch-based calculations)
const VERTICAL_ABBREVIATION_THRESHOLD_PX = 50;  // Vertical toolbar width < 50px → abbreviate
const HORIZONTAL_ITEM_THRESHOLD_PX = 30;         // Horizontal toolbar per-item width < 30px → abbreviate

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
      // Vertical toolbar: check width in CSS pixels
      setIsAbbreviated(el.offsetWidth < VERTICAL_ABBREVIATION_THRESHOLD_PX);
    } else {
      // Horizontal toolbar: check available width per item in CSS pixels
      const totalWidth = el.offsetWidth;
      const gap = 8; // approximate gap between items in pixels
      const totalGaps = (itemCount - 1) * gap;
      const availableWidthPerItem = (totalWidth - totalGaps) / itemCount;
      setIsAbbreviated(availableWidthPerItem < HORIZONTAL_ITEM_THRESHOLD_PX);
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
