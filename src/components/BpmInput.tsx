import React, { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface BpmInputProps {
  className?: string;
  onPendingChange: (bpm: number) => void;
}

export const BpmInput: React.FC<BpmInputProps> = ({ className, onPendingChange }) => {
  const bpm = useStore(s => s.bpm);
  const setBpm = useStore(s => s.setBpm);
  const tracks = useStore(s => s.tracks);
  
  const [localBpm, setLocalBpm] = useState(bpm.toString());
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; value: number } | null>(null);

  const commitChange = (value: number) => {
    const newVal = isNaN(value) ? bpm : Math.max(30, Math.min(300, value));
    const hasAudio = (tracks || []).some(t => t.id !== 'metronome' && t.phrases.length > 0);
    
    if (hasAudio && newVal !== bpm) {
      onPendingChange(newVal);
    } else {
      setBpm(newVal);
    }
    setLocalBpm(newVal.toString());
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitChange(Number(localBpm));
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setLocalBpm(bpm.toString());
      setIsEditing(false);
      inputRef.current?.blur();
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditing) return;
    
    // Start dragging
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      value: bpm
    };
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragStartRef.current) return;
      
      const deltaX = moveEvent.clientX - dragStartRef.current.x;
      const deltaY = dragStartRef.current.y - moveEvent.clientY; // Up is positive
      
      // Use the larger delta for sensitivity
      const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
      const sensitivity = 0.5;
      const newValue = Math.max(30, Math.min(300, Math.round(dragStartRef.current.value + delta * sensitivity)));
      
      setLocalBpm(newValue.toString());
    };
    
    const handlePointerUp = () => {
      if (dragStartRef.current) {
        const finalValue = Number(localBpm);
        if (finalValue !== dragStartRef.current.value) {
          commitChange(finalValue);
        }
      }
      dragStartRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const adjustBpm = (delta: number) => {
    const newVal = Math.max(30, Math.min(300, Number(localBpm) + delta));
    setLocalBpm(newVal.toString());
    // Auto-commit after a short delay if using buttons? 
    // Or just let the user click "Proceed" in the modal if needed.
    // For buttons, let's commit immediately if no audio, otherwise wait for blur/enter.
    const hasAudio = (tracks || []).some(t => t.id !== 'metronome' && t.phrases.length > 0);
    if (!hasAudio) {
      setBpm(newVal);
    }
  };

  return (
    <div className={cn("flex items-center gap-1 bg-zinc-800/50 rounded-lg p-1 border border-zinc-700/50", className)}>
      <div className="flex flex-col gap-0.5">
        <button 
          onClick={() => adjustBpm(1)}
          className="p-1 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-200 transition-colors"
          title="Increase BPM"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button 
          onClick={() => adjustBpm(-1)}
          className="p-1 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-200 transition-colors"
          title="Decrease BPM"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      
      <div 
        className="relative group cursor-ew-resize select-none px-2 py-1"
        onPointerDown={handlePointerDown}
        onDoubleClick={() => {
          setIsEditing(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={localBpm}
          onChange={(e) => setLocalBpm(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsEditing(true)}
          onBlur={() => commitChange(Number(localBpm))}
          className={cn(
            "w-12 bg-transparent outline-none text-center text-sm font-mono font-bold transition-all",
            isEditing ? "text-white" : "text-zinc-300 group-hover:text-white"
          )}
        />
        {!isEditing && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-zinc-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      
      <span className="text-[9px] uppercase tracking-tighter text-zinc-500 font-bold pr-2">BPM</span>
    </div>
  );
};
