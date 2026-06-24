import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useStore } from '../store/useStore';
import { Repeat, Trash2, X } from 'lucide-react';

export const TakeBar: React.FC = () => {
  const {
    tracks,
    selectedPhraseId,
    setSelectedPhraseId,
    updatePhrasePosition,
    updatePhrase,
    shiftAllPhrases,
    removePhrase,
    zoom,
    syncLoop,
    setSyncLoop,
    longPressX,
    longPressTrackRect,
    setLongPressPosition,
  } = useStore();

  const [scrollLeft, setScrollLeft] = useState(0);
  const [barHeight, setBarHeight] = useState(180);
  const [barWidth, setBarWidth] = useState(380);
  const toolRef = useRef<HTMLDivElement>(null);

  // Find selected phrase
  type PhraseWithSync = { id: string; name: string; startPosition: number; duration: number; originalStartPosition?: number; headLength: number; anchoredFrame?: number; originalAnchoredFrame?: number };
  let selectedPhrase: PhraseWithSync | null = null;
  let selectedTrack: { id: string; phrases: PhraseWithSync[] } | null = null;

  const trackList = tracks || [];
  for (let i = 0; i < trackList.length; i++) {
    const t = trackList[i];
    for (const p of (t.phrases || [])) {
      if (p.id === selectedPhraseId) {
        selectedPhrase = p as PhraseWithSync;
        selectedTrack = t as { id: string; phrases: PhraseWithSync[] };
        break;
      }
    }
    if (selectedPhrase) break;
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolRef.current && !toolRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (target.closest('wave')) return;
        setSelectedPhraseId(null);
        setLongPressPosition(null, null);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [setSelectedPhraseId, setLongPressPosition]);

  // Measure bar dimensions after render for precise positioning
  useLayoutEffect(() => {
    if (toolRef.current) {
      const h = toolRef.current.offsetHeight;
      const w = toolRef.current.offsetWidth;
      if (h !== barHeight) setBarHeight(h);
      if (w !== barWidth) setBarWidth(w);
    }
  }, [selectedPhraseId, barHeight, barWidth]);

  // Poll scroll position for fallback x positioning
  useEffect(() => {
    let frameId: number;
    const updateScroll = () => {
      const container = document.querySelector('.multitrack-container');
      if (container && container.firstChild instanceof HTMLElement && container.firstChild.shadowRoot) {
        const scrollContainer = container.firstChild.shadowRoot.querySelector('.scroll');
        if (scrollContainer) {
          setScrollLeft(scrollContainer.scrollLeft);
        }
      }
      frameId = requestAnimationFrame(updateScroll);
    };
    frameId = requestAnimationFrame(updateScroll);
    return () => cancelAnimationFrame(frameId);
  }, []);

  if (!selectedPhrase) return null;

  const toolWidth = 380;

  // --- X: center on press point (viewport-relative) ---
  let rawLeft: number;
  if (longPressX != null) {
    rawLeft = longPressX - toolWidth / 2;
  } else if (longPressTrackRect) {
    rawLeft = longPressTrackRect.left + longPressTrackRect.width / 2 - toolWidth / 2;
  } else {
    // Fallback: phrase start position in viewport
    const containerEl = document.querySelector('.multitrack-container');
    const sectionEl = containerEl?.parentElement;
    const sectionRect = sectionEl?.getBoundingClientRect() ?? { left: 0 };
    rawLeft = sectionRect.left + (selectedPhrase.startPosition * zoom) - scrollLeft;
  }
  const left = Math.max(10, Math.min(rawLeft, window.innerWidth - barWidth - 10));

  // --- Y: above or below track using actual DOM rect ---
  let top: number;
  if (longPressTrackRect) {
    const spaceAbove = longPressTrackRect.top;
    const spaceBelow = window.innerHeight - longPressTrackRect.bottom;
    const placeBelow = spaceBelow >= barHeight || spaceBelow >= spaceAbove;

    if (placeBelow) {
      // Bar's top edge = track's bottom edge (flush below)
      top = longPressTrackRect.bottom;
    } else {
      // Bar's bottom edge = track's top edge (flush above)
      top = longPressTrackRect.top - barHeight;
    }
  } else {
    // Fallback (should not happen — both click and longpress provide trackRect)
    top = 100;
  }

  // Debug log
  console.log('[TakeBar] position:', {
    longPressX, longPressTrackRect, barHeight, toolWidth,
    spaceAbove: longPressTrackRect?.top,
    spaceBelow: longPressTrackRect ? window.innerHeight - longPressTrackRect.bottom : null,
    placeBelow: longPressTrackRect ? (window.innerHeight - longPressTrackRect.bottom >= barHeight || window.innerHeight - longPressTrackRect.bottom >= longPressTrackRect.top) : null,
    left, top, zoom, startPosition: selectedPhrase.startPosition, scrollLeft,
  });

  const handleOffset = (amount: number) => {
    if (!selectedPhrase || !selectedTrack) return;
    const newPosition = selectedPhrase.startPosition + amount;
    if (newPosition < 0) {
      const shiftAmount = Math.abs(newPosition);
      shiftAllPhrases(shiftAmount, selectedPhrase.id);
      updatePhrasePosition(selectedTrack.id, selectedPhrase.id, 0);
    } else {
      updatePhrasePosition(selectedTrack.id, selectedPhrase.id, newPosition);
    }
  };

  const toggleLoop = () => {
    if (!selectedPhrase) return;
    if (syncLoop) {
      setSyncLoop(null);
    } else {
      setSyncLoop({
        start: Math.max(0, selectedPhrase.startPosition - 2),
        end: selectedPhrase.startPosition + selectedPhrase.duration + 2
      });
    }
  };

  return (
    <div
      ref={toolRef}
      className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 flex flex-col gap-3 transition-all duration-100 min-w-[360px]"
      style={{ left, top }}
    >
      {/* Row 1: Name and Head Length */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Phrase Name</div>
          <input
            type="text"
            value={selectedPhrase.name || ''}
            onChange={(e) => updatePhrase(selectedTrack.id, selectedPhrase.id, { name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-24"
            placeholder="e.g. Take 1"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <div className="w-px h-8 bg-gray-600 mx-1"></div>

        <div className="flex flex-col gap-1">
          <div className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Head (s)</div>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={selectedPhrase.headLength}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) {
                updatePhrase(selectedTrack.id, selectedPhrase.id, { headLength: val });
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-14 text-right"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1">
          <div className="text-[10px] text-gray-300 font-medium mb-1">Nudge Clip Position:</div>
          <div className="flex items-center gap-1">
            <button onClick={() => handleOffset(-1)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white transition-colors" title="Shift earlier by 1 second">-1s</button>
            <button onClick={() => handleOffset(-0.1)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white transition-colors" title="Shift earlier by 100 milliseconds">-0.1s</button>
            <button onClick={() => handleOffset(-0.01)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white transition-colors" title="Shift earlier by 10 milliseconds">-10ms</button>
            <div className="w-px h-4 bg-gray-600 mx-1"></div>
            <button onClick={() => handleOffset(0.01)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white transition-colors" title="Shift later by 10 milliseconds">+10ms</button>
            <button onClick={() => handleOffset(0.1)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white transition-colors" title="Shift later by 100 milliseconds">+0.1s</button>
          </div>
        </div>
      </div>

      {/* Row 2: Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
        {selectedPhrase.originalAnchoredFrame !== undefined && selectedPhrase.originalAnchoredFrame !== 0 && (
          <>
            <button
              onClick={() => {
                const state = useStore.getState();
                const anchorFrame = selectedPhrase.originalAnchoredFrame;
                const sampleRate = state.sampleRate;
                const beatsPerSecond = (state.bpm || 120) / 60;
                const secondsPerBar = (1 / beatsPerSecond) * (state.timeSignature?.[0] || 4);
                const newStartPosition = (anchorFrame / sampleRate) - secondsPerBar - selectedPhrase.headLength;
                updatePhrase(selectedTrack.id, selectedPhrase.id, {
                  anchoredFrame: anchorFrame,
                  startPosition: Math.max(0, newStartPosition)
                });
              }}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-white transition-colors"
              title="Reset to original recorded position"
            >
              Reset
            </button>

            {selectedPhrase.startPosition < selectedPhrase.originalStartPosition! && (
              <button
                onClick={() => {
                  const latencySec = selectedPhrase.originalStartPosition! - selectedPhrase.startPosition;
                  useStore.getState().setGlobalLatencyMs(Math.round(latencySec * 1000));
                  alert(`Global latency compensation set to ${Math.round(latencySec * 1000)}ms`);
                }}
                className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-[10px] text-white transition-colors"
                title="Set this offset as the global latency compensation for future recordings"
              >
                Set Global
              </button>
            )}
            <div className="w-px h-4 bg-gray-600 mx-1"></div>
          </>
        )}

        <button
          onClick={toggleLoop}
          className={`px-2 py-1 rounded text-[10px] flex items-center transition-colors ${syncLoop ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          title="Loop playback ±2s around clip"
        >
          <Repeat className="w-3 h-3 mr-1" />
          Loop ±2s
        </button>

        <div className="flex-1"></div>

        <button
          onClick={() => {
            removePhrase(selectedTrack.id, selectedPhrase.id);
            setSelectedPhraseId(null);
            setLongPressPosition(null, null);
            if (syncLoop) setSyncLoop(null);
          }}
          className="p-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded transition-colors"
          title="Delete clip"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => {
            setSelectedPhraseId(null);
            setLongPressPosition(null, null);
            setSyncLoop(null);
          }}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
