import React, { useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { cn, getContrastColor, generateVoiceTags, generate3WayTags, getTrackShortLabel } from '../lib/utils';
import { Mic, Activity, RotateCcw } from 'lucide-react';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';

export const TrackBar = ({ mode = 'mixer' as const, handlers }: { mode?: 'mixer' | 'lyrics'; handlers: any }) => {
  const tracks = useStore(s => s.tracks);
  const selectedTrackId = useStore(s => s.selectedTrackId);
  const activeColorId = useStore(s => s.activeColorId);
  const setActiveColorId = useStore(s => s.setActiveColorId);
  const isRecording = useStore(s => s.isRecording);
  
  const envelopeLocked = useStore(s => s.envelopeLocked);
  const sidebarWidth = useStore(s => s.sidebarWidth);
  const trackHeight = useStore(s => s.trackHeight);
  const metronomeHeight = useStore(s => s.metronomeHeight);
  const toolbarProposal = useStore(s => s.toolbarProposal);
  const toolbarVisibleLabels = useStore(s => s.toolbarVisibleLabels);
  const toolbarVertical = useToolbarContext('vertical');
  const screenSize = toolbarVertical.screenSize;
  const isPortrait = toolbarVertical.isPortrait;
  
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
    handleMutePointerUp,
    handleUndoRecording,
  } = handlers;

  const recordLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const isCompact = toolbarProposal === 3;
  const showLabels = toolbarVisibleLabels && !isCompact;
  
  // Determine if single-row layout is needed based on track height
  // If track height < 80px, force single row (label + mute/record side-by-side)
  const lyricsHeightMultiplier = mode === 'lyrics' ? 0.6 : 1;
  const singleRowThreshold = 80;
  const useSingleRow = (trackHeight * lyricsHeightMultiplier) < singleRowThreshold;
  
  const [show3Way, setShow3Way] = useState(false);
  const tags = React.useMemo(() => mode === 'lyrics' ? generateVoiceTags(tracks) : [], [mode, tracks]);
  const tags3Way = React.useMemo(() => mode === 'lyrics' && show3Way ? generate3WayTags(tracks) : [], [mode, tracks, show3Way]);

  return mode === 'lyrics' && isPortrait && screenSize === 'small' ? (
    /* Portrait lyrics: fixed bottom bar with per-track columns + composite tags */
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-800 p-1.5 gap-1.5 flex-row items-start flex flex-wrap">
      <div className="flex flex-row gap-1.5 shrink-0">
        {(tracks || []).filter(t => t.id !== 'metronome').map(track => (
        <div key={track.id} className="flex flex-col items-center gap-1 shrink-0">
          <button
            onClick={() => handleRecord(track.id)}
            className={cn(
              "rounded flex items-center justify-center transition-colors",
              getToolbarBtnClass(true),
              isRecording && selectedTrackId === track.id
                ? "bg-red-500 text-white animate-pulse"
                : "bg-zinc-800 text-red-400 hover:bg-zinc-700"
            )}
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            onClick={() => useStore.getState().updateTrack?.(track.id, { isMuted: !track.isMuted })}
            className={cn(
              "rounded flex items-center justify-center font-bold transition-colors",
              getToolbarBtnClass(true),
              track.isMuted ? "bg-red-500/20 text-red-400" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            )}
          >
            M
          </button>
          <button
            onClick={() => setActiveColorId(track.color)}
            className={cn(
              "rounded font-bold transition-all select-none",
              getToolbarBtnClass(true),
              activeColorId === track.color ? "ring-2 ring-white scale-105" : "hover:scale-105"
            )}
            style={{ backgroundColor: track.color, color: getContrastColor(track.color) }}
          >
            {getTrackShortLabel(track, 3)}
          </button>
        </div>
      ))}
      </div>
      {tags.length > 0 && <div className="w-px self-stretch bg-zinc-800 mx-1.5 shrink-0" />
      }
      {tags.filter(t => t.trackIds.length !== 1).concat(tags3Way).map(tag => (
        <button
          key={tag.id}
          onClick={() => setActiveColorId(tag.color)}
          className={cn(
            "rounded font-bold transition-all select-none",
            getToolbarBtnClass(true),
            activeColorId === tag.color ? "ring-2 ring-white scale-105" : "hover:scale-105"
          )}
          style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
        >
          {tag.label}
        </button>
      ))}
      {!show3Way && (
        <button
          onClick={() => setShow3Way(true)}
          className={cn("rounded font-bold transition-all select-none", getToolbarBtnClass(true), "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}
        >+</button>
      )}
    </div>
  ) : (
    /* Landscape sidebar - current behavior */
    <aside 
      style={{
        width: isCompact ? '64px' : sidebarWidth,
        overflowY: 'auto'
      }}
      className="bg-zinc-900/30 shrink-0 flex flex-col left-0 border-r border-zinc-800 select-none"
    >
      <div className="flex flex-col flex-1">
        {(tracks || []).filter(t => t.id !== 'metronome').map((track) => {
          const isMetronome = track.id === 'metronome';
          const isExpanded = track.id === selectedTrackId && !envelopeLocked && !isMetronome;
          const currentHeight = isMetronome ? metronomeHeight : Math.floor((isExpanded ? trackHeight * 1.5 : trackHeight) * lyricsHeightMultiplier);
          
          const shortLabel = getTrackShortLabel(track, 4);
          const trackColor = track.color || '#666';
          const contrastColor = getContrastColor(trackColor);
          
          return (
            <div 
              key={track.id}
              onPointerDown={() => handleTrackPointerDown(track.id)}
              onPointerUp={() => handleTrackPointerUp(track.id)}
              onPointerLeave={handleTrackPointerLeave}
              className={cn(
                "p-1.5 transition-all cursor-pointer group relative overflow-hidden border-b border-zinc-800",
                selectedTrackId === track.id ? "bg-zinc-800/80 shadow-sm" : "bg-zinc-900/50 hover:bg-zinc-800/50"
              )}
              style={{ height: currentHeight }}
            >
              <div 
                className="absolute right-0 top-0 bottom-0 w-1.5"
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
                      onClick={() => mode === 'lyrics' ? setActiveColorId(track.color) : useStore.getState().setSelectedTrackId(track.id)}
                      className={cn(
                        "rounded flex items-center justify-center font-bold transition-all",
                        mode === 'lyrics' ? getToolbarBtnClass(true) : "w-full h-full text-[10px]",
                        mode === 'lyrics' && (activeColorId === track.color ? "ring-2 ring-white scale-105" : "hover:scale-105")
                      )}
                      style={{ 
                        backgroundColor: trackColor,
                        color: contrastColor,
                        minHeight: mode === 'lyrics' ? undefined : '44px'
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
                    {isRecording && selectedTrackId === track.id ? (
                      <button
                        onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                        className={cn(
                          "rounded flex items-center justify-center",
                          getToolbarBtnClass(true),
                          "bg-amber-500/20 text-amber-400 border border-amber-500/30 flex-1"
                        )}
                        title="Cancel recording"
                      >
                        <RotateCcw size={14} />
                      </button>
                    ) : (
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
                    )}
                      {!isMetronome && (
                        <button 
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            recordLongPressTimer.current = setTimeout(() => {
                              recordLongPressTimer.current = null;
                              handleUndoRecording();
                            }, 2000);
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            if (recordLongPressTimer.current) {
                              clearTimeout(recordLongPressTimer.current);
                              recordLongPressTimer.current = null;
                              handleRecord(track.id);
                            }
                          }}
                          onPointerLeave={() => {
                            if (recordLongPressTimer.current) {
                              clearTimeout(recordLongPressTimer.current);
                              recordLongPressTimer.current = null;
                            }
                          }}
                          className={cn(
                            "rounded flex items-center justify-center transition-colors flex-1",
                            getToolbarBtnClass(true),
                            isRecording && selectedTrackId === track.id
                              ? "bg-red-500 text-white animate-pulse" 
                              : "bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-300"
                          )}
                        >
                          <Mic className="w-4 h-4" />
                        </button>
                      )}
                  </div>
                ) : (
                  /* Two rows: label button (row 1), mute/record (row 2) */
                  <div className="flex gap-1 p-1">
                    {isRecording && selectedTrackId === track.id ? (
                      <button
                        onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                        className={cn(
                          "rounded flex items-center justify-center",
                          isCompact ? "w-8 h-8" : "flex-1",
                          getToolbarBtnClass(true),
                          "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        )}
                        title="Cancel recording"
                      >
                        <RotateCcw size={14} />
                      </button>
                    ) : (
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
                        {isMetronome ? <Activity className="w-4 h-4" /> : (track.isSolo ? getLabel('Solo', 'S') : getLabel('Mute', 'M'))}
                      </button>
                    )}
                      {!isMetronome && (
                        <button 
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            recordLongPressTimer.current = setTimeout(() => {
                              recordLongPressTimer.current = null;
                              handleUndoRecording();
                            }, 2000);
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            if (recordLongPressTimer.current) {
                              clearTimeout(recordLongPressTimer.current);
                              recordLongPressTimer.current = null;
                              handleRecord(track.id);
                            }
                          }}
                          onPointerLeave={() => {
                            if (recordLongPressTimer.current) {
                              clearTimeout(recordLongPressTimer.current);
                              recordLongPressTimer.current = null;
                            }
                          }}
                          className={cn(
                            "rounded flex items-center justify-center transition-colors",
                            isCompact ? "w-8 h-8" : "flex-1",
                            getToolbarBtnClass(true),
                            isRecording && selectedTrackId === track.id
                              ? "bg-red-500 text-white animate-pulse" 
                              : "bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-300"
                          )}
                        >
                          <Mic className="w-4 h-4" />
                        </button>
                      )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        
        {mode === 'lyrics' && (
          <div className="border-t border-zinc-800 p-2">
            <div className="grid grid-flow-col grid-rows-3 gap-1.5">
              {[...tags.filter(t => t.trackIds.length !== 1), ...tags3Way].map(tag => (
                <button
                  key={tag.id}
                  onClick={() => setActiveColorId(tag.color)}
                  className={cn(
                    "rounded font-bold transition-all select-none",
                    getToolbarBtnClass(true),
                    activeColorId === tag.color ? "ring-2 ring-white scale-105" : "hover:scale-105"
                  )}
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.label}
                </button>
              ))}
              {!show3Way && <button
                onClick={() => setShow3Way(true)}
                className={cn("rounded font-bold transition-all select-none bg-zinc-800 text-zinc-400 hover:bg-zinc-700", getToolbarBtnClass(true))}
              >+</button>}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
