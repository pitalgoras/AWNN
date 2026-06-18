import { useState, useRef, useMemo, useCallback } from 'react';

interface FeedbackActivators {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
}

const LONG_PRESS_MS = 500;

export function useFeedbackActivation() {
  const [showFeedback, setShowFeedback] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const feedbackActivators: FeedbackActivators = useMemo(() => ({
    onPointerDown: () => {
      skipNextClickRef.current = false;
      timerRef.current = setTimeout(() => {
        setShowFeedback(v => !v);
        skipNextClickRef.current = true;
        timerRef.current = null;
      }, LONG_PRESS_MS);
    },
    onPointerUp: () => clearTimer(),
    onPointerLeave: () => {
      clearTimer();
      skipNextClickRef.current = false;
    },
  }), [clearTimer]);

  const handleCuesClick = useCallback((): boolean => {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return true; // suppress cues toggle
    }
    return false; // proceed with normal cues toggle
  }, []);

  return { showFeedback, setShowFeedback, feedbackActivators, handleCuesClick };
}
