import React, { useEffect, useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Repeat, Trash2, X } from 'lucide-react';

export const SyncTool: React.FC = () => {
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
    envelopeLocked,
    selectedTrackId
  } = useStore();
  
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const toolRef = useRef<HTMLDivElement>(null);
  
  // Find selected phrase and calculate its visual row index
  let selectedPhrase: { id: string; name: string; startPosition: number; duration: number; originalStartPosition?: number } | null = null;
  let selectedTrack: { id: string; phrases: { id: string; name: string; startPosition: number; duration: number }[] } | null = null;
  let trackIndex = -1;
  
  const trackList = tracks || [];
  for (let i = 0; i < trackList.length; i++) {
    const t = trackList[i];
    for (const p of (t.phrases || [])) {
      if (p.id === selectedPhraseId) {
        selectedPhrase = p as { id: string; name: string; startPosition: number; duration: number; originalStartPosition?: number };
        selectedTrack = t as { id: string; phrases: { id: string; name: string; startPosition: number; duration: number }[] };
        trackIndex = i;
        break;
      }
    }
    if (selectedPhrase) break;
  }
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolRef.current && !toolRef.current.contains(e.target as Node)) {
        // Also check if we clicked on a wavesurfer element to avoid immediately closing when selecting a new phrase
        const target = e.target as HTMLElement;
        if (!target.closest('wave') && !target.closest('.multitrack-container')) {
          setSelectedPhraseId(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setSelectedPhraseId]);
  
  useEffect(() => {
    let frameId: number;
    const updateScroll = () => {
      const container = document.querySelector('.multitrack-container');
      if (container && container.firstChild instanceof HTMLElement && container.firstChild.shadowRoot) {
        const scrollContainer = container.firstChild.shadowRoot.querySelector('.scroll');
        if (scrollContainer) {
          setScrollLeft(scrollContainer.scrollLeft);
          setScrollTop(scrollContainer.scrollTop);
        }
      }
      frameId = requestAnimationFrame(updateScroll);
    };
    frameId = requestAnimationFrame(updateScroll);
    return () => cancelAnimationFrame(frameId);
  }, []);
  
  if (!selectedPhrase || trackIndex === -1) return null;
  
  const left = (selectedPhrase.startPosition * zoom) - scrollLeft;
  
  // Calculate actual top position by summing heights of preceding tracks
  let topOffset = 0;
  for (let i = 0; i < trackIndex; i++) {
    const t = trackList[i];
    const isMetronome = t.id === 'metronome';
    const isExpanded = t.id === selectedTrackId && !envelopeLocked && !isMetronome;
    topOffset += isMetronome ? 40 : (isExpanded ? 80 : 50);
  }
  
  // Position it just below the track
  const selTrack = trackList[trackIndex];
  const isSelMetronome = selTrack.id === 'metronome';
  const isSelExpanded = selTrack.id === selectedTrackId && !envelopeLocked && !isSelMetronome;
  const selHeight = isSelMetronome ? 40 : (isSelExpanded ? 80 : 50);
  
  // Account for the timeline height (approx 20px)
  const timelineHeight = 20;
  const top = topOffset + selHeight + timelineHeight - scrollTop;
  
  const handleOffset = (amount: number) => {
    if (!selectedPhrase || !selectedTrack) return;
    const newPosition = selectedPhrase.startPosition + amount;
    if (newPosition < 0) {
      // If we try to move before 0, we instead move ALL OTHER phrases forward
      // by the amount we would have gone negative, and set this phrase to 0.
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
      className="absolute z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-2 flex items-center space-x-2 transition-all duration-100"
      style={{ left: Math.max(0, left), top }}
    >
      <div className="flex flex-col gap-1 mr-2">
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

      <div className="text-xs text-gray-300 font-medium mr-1">Latency Comp:</div>
      
      <button onClick={() => handleOffset(-1)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors" title="Shift earlier by 1 second">-1s</button>
      <button onClick={() => handleOffset(-0.1)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors" title="Shift earlier by 100 milliseconds">-0.1s</button>
      <button onClick={() => handleOffset(-0.01)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors" title="Shift earlier by 10 milliseconds">-10ms</button>
      
      <div className="w-px h-4 bg-gray-600 mx-1"></div>
      
      <button onClick={() => handleOffset(0.01)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors" title="Shift later by 10 milliseconds">+10ms</button>
      <button onClick={() => handleOffset(0.1)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors" title="Shift later by 100 milliseconds">+0.1s</button>
      
      {selectedPhrase.originalStartPosition !== undefined && (
        <>
          <div className="w-px h-4 bg-gray-600 mx-1"></div>
          <button 
            onClick={() => updatePhrasePosition(selectedTrack.id, selectedPhrase.id, selectedPhrase.originalStartPosition!)} 
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition-colors" 
            title="Reset to original recorded position"
          >
            Reset
          </button>
          
          {selectedPhrase.startPosition < selectedPhrase.originalStartPosition && (
            <button 
              onClick={() => {
                const latencySec = selectedPhrase.originalStartPosition! - selectedPhrase.startPosition;
                useStore.getState().setGlobalLatencyMs(Math.round(latencySec * 1000));
                alert(`Global latency compensation set to ${Math.round(latencySec * 1000)}ms`);
              }} 
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs text-white transition-colors ml-1" 
              title="Set this offset as the global latency compensation for future recordings"
            >
              Set Global
            </button>
          )}
        </>
      )}
      
      <div className="w-px h-4 bg-gray-600 mx-1"></div>
      
      <button 
        onClick={toggleLoop} 
        className={`px-2 py-1 rounded text-xs flex items-center transition-colors ${syncLoop ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        title="Loop playback ±2s around clip"
      >
        <Repeat className="w-3 h-3 mr-1" />
        Loop ±2s
      </button>
      
      <div className="w-px h-4 bg-gray-600 mx-1"></div>
      
      <button 
        onClick={() => {
          removePhrase(selectedTrack.id, selectedPhrase.id);
          setSelectedPhraseId(null);
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
          setSyncLoop(null);
        }} 
        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors ml-1"
        title="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
