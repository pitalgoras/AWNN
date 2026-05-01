import React from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { Mic, Activity } from 'lucide-react';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';
import { getContrastColor } from '../lib/utils';

const VOICE_TOKENS: Record<string, string> = {
  'Unison': '[ALL]',
  'Soprano': '[S]',
  'Alto': '[A]',
  'Tenor': '[T]',
  'Bass': '[B]',
  'Soprano & Alto': '[S&A]',
  'Tenor & Bass': '[T&B]',
};

export const TrackToolbar = ({ handlers }: { handlers: any }) => {
  const tracks = useStore(s => s.tracks);
  const selectedTrackId = useStore(s => s.selectedTrackId);
  const isRecording = useStore(s => s.isRecording);
  
  const envelopeLocked = useStore(s => s.envelopeLocked);
  const sidebarWidth = useStore(s => s.sidebarWidth);
  const trackHeight = useStore(s => s.trackHeight);
  const metronomeHeight = useStore(s => s.metronomeHeight);
  const toolbarProposal = useStore(s => s.toolbarProposal);
  const toolbarVisibleLabels = useStore(s => s.toolbarVisibleLabels);
  
  const toolbarContext = useToolbarContext('vertical');
  const isPortrait = toolbarContext.isPortrait;
  const screenSize = toolbarContext.screenSize;
  
  // Responsive sizing based on screenSize
  const { smallBtnSize, mediumBtnSize, largeBtnSize } = useStore();
  const toolbarBtnSize = screenSize === 'small' 
    ? `min-h-[${smallBtnSize}px] p-1 text-[9px]`
    : screenSize === 'medium' 
    ? `min-h-[${mediumBtnSize}px] p-1.5 text-[10px]`
    : `min-h-[${largeBtnSize}px] p-2 text-xs`;
  
  const getToolbarBtnClass = (isSquare = false) => cn(toolbarBtnSize, isSquare ? 'aspect-square' : '');
  
  const { isAbbreviated, getLabel } = useAdaptiveLabels(
    { current: null } as React.RefObject<HTMLElement>,
    'vertical',
    (tracks || []).length + 1
  );
  
  const { 
    handleTrackPointerDown, 
    handleTrackPointerUp, 
    handleTrackPointerLeave, 
    handleRecord, 
    handleMutePointerDown, 
    handleMutePointerUp 
  } = handlers;
  
  const proposalClasses = {
    1: "flex-col border-r border-zinc-800 select-none", // sidebar (left edge)
    2: "flex-row border-b border-zinc-800 overflow-x-auto select-none", // top nav bar
    3: "flex-col border-r border-zinc-800 w-16 select-none" // compact
  };
  
  const isCompact = toolbarProposal === 3;
  const isHorizontal = toolbarProposal === 2;
  const showLabels = toolbarVisibleLabels && !isCompact;
  
  // Determine if single-row layout is needed based on track height
  // If track height < 80px, force single row (label + mute/record side-by-side)
  const singleRowThreshold = 80;
  const useSingleRow = trackHeight < singleRowThreshold;
  
  const getShortLabel = (track: any) => {
    return VOICE_TOKENS[track.label] || VOICE_TOKENS[track.name] || track.name.substring(0, 3);
  };
  
  return (
    <aside 
      style={{
        ...(toolbarProposal === 1 ? { width: sidebarWidth } : {}),
        ...(isHorizontal ? { height: '80px' } : {})
      }}
      className={cn("bg-zinc-900/30 shrink-0 flex left-0", isHorizontal ? "" : "overflow-y-auto", proposalClasses[toolbarProposal as 1|2|3])}
    >
      <div className={cn("flex", isHorizontal ? "flex-row" : "flex-col flex-1")}>
        {(tracks || []).map((track) => {
          const isMetronome = track.id === 'metronome';
          const isExpanded = track.id === selectedTrackId && !envelopeLocked && !isMetronome;
          const currentHeight = isMetronome ? metronomeHeight : (isExpanded ? trackHeight * 1.5 : trackHeight);
          
          const shortLabel = getShortLabel(track);
          const trackColor = track.color || '#666';
          const contrastColor = getContrastColor(trackColor);
          
          return (
            <div 
              key={track.id}
              onPointerDown={() => handleTrackPointerDown(track.id)}
              onPointerUp={() => handleTrackPointerUp(track.id)}
              onPointerLeave={handleTrackPointerLeave}
              className={cn(
                "p-1.5 transition-all cursor-pointer group relative overflow-hidden border-zinc-800",
                isHorizontal ? "border-r w-48 flex-col" : "border-b",
                selectedTrackId === track.id ? "bg-zinc-800/80 shadow-sm" : "bg-zinc-900/50 hover:bg-zinc-800/50"
              )}
              style={isHorizontal ? {} : { height: currentHeight }}
            >
              <div 
                className={cn("absolute", isHorizontal ? "left-0 bottom-0 right-0 h-1" : "right-0 top-0 bottom-0 w-1.5")}
                style={{ backgroundColor: trackColor }} 
              />
              
              <div className={cn(
                "w-full h-full",
                useSingleRow 
                  ? "flex flex-row items-center p-1 gap-1" // Single row: all buttons side-by-side
                  : "flex flex-col" // Two rows: label button (row 1), mute/record (row 2)
              )}>
                {/* Label inside colored button - always visible */}
                {!isMetronome && (
                  <div className={cn(
                    "flex gap-1",
                    useSingleRow ? "flex-1" : "w-full"
                  )}>
                    <button
                      onClick={() => useStore.getState().setSelectedTrackId(track.id)}
                      className="w-full h-full rounded flex items-center justify-center text-[10px] font-bold transition-all"
                      style={{ 
                        backgroundColor: trackColor,
                        color: contrastColor,
                        minHeight: '44px'
                      }}
                      title={track.name}
                    >
                      {shortLabel}
                    </button>
                  </div>
                )}
               
                {/* Mute/Solo & Record buttons */}
                {useSingleRow ? (
                  /* Same row as label button */
                  <div className="flex gap-1 flex-1">
                    <button 
                      onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                      onPointerUp={(e) => handleMutePointerUp(e, track.id, track.isMuted)}
                      className={cn(
                        "rounded flex items-center justify-center text-[10px] font-bold transition-all select-none flex-1",
                        getToolbarBtnClass(true),
                        track.isSolo 
                          ? "bg-yellow-500 text-yellow-950 shadow-[0_0_10px_rgba(234,179,8,0.4)]" 
                          : track.isMuted 
                            ? "bg-red-500/20 text-red-400" 
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                      )}
                      title="Tap to Mute, Hold to Solo"
                    >
                      {track.isSolo ? getLabel('Solo', 'S') : getLabel('Mute', 'M')}
                    </button>
                    {!isMetronome && (
                      <button 
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRecord(track.id); }}
                        className={cn(
                          "rounded flex items-center justify-center transition-colors flex-1",
                          getToolbarBtnClass(true),
                          isRecording && selectedTrackId === track.id
                            ? "bg-red-500 text-white animate-pulse" 
                            : "bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-300"
                        )}
                      >
                        <Mic className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  /* Two rows: label button (row 1), mute/record (row 2) */
                  <div className={cn("flex gap-1 p-1", isHorizontal && "flex-row")}>
                    <button 
                      onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                      onPointerUp={(e) => handleMutePointerUp(e, track.id, track.isMuted)}
                      className={cn(
                        "rounded flex items-center justify-center text-[10px] font-bold transition-all select-none",
                        isCompact ? "w-8 h-8" : "flex-1",
                        getToolbarBtnClass(true),
                        track.isSolo 
                          ? "bg-yellow-500 text-yellow-950 shadow-[0_0_10px_rgba(234,179,8,0.4)]" 
                          : track.isMuted 
                            ? "bg-red-500/20 text-red-400" 
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                      )}
                      title="Tap to Mute, Hold to Solo"
                    >
                      {isMetronome ? <Activity className="w-3.5 h-3.5" /> : (track.isSolo ? getLabel('Solo', 'S') : getLabel('Mute', 'M'))}
                    </button>
                    {!isMetronome && (
                      <button 
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRecord(track.id); }}
                        className={cn(
                          "rounded flex items-center justify-center transition-colors",
                          isCompact ? "w-8 h-8" : "flex-1",
                          getToolbarBtnClass(true),
                          isRecording && selectedTrackId === track.id
                            ? "bg-red-500 text-white animate-pulse" 
                            : "bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-300"
                        )}
                      >
                        <Mic className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
