import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { cn, getContrastColor, blendColors, getTrackShortLabel, getTrackTagLabel, getTagColor } from '../lib/utils';
import { Mic, Activity, RotateCcw } from 'lucide-react';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';
import { VoicingChooserModal } from './modals/VoicingChooserModal';

export const TrackBar = ({ mode = 'mixer' as const, handlers }: { mode?: 'mixer' | 'lyrics'; handlers: any }) => {
  const tracks = useStore(s => s.tracks);
  const selectedTrackId = useStore(s => s.selectedTrackId);
  const activeTagId = useStore(s => s.activeTagId);
  const setActiveTagId = useStore(s => s.setActiveTagId);
  const isRecording = useStore(s => s.isRecording);
  
  const envelopeLocked = useStore(s => s.envelopeLocked);
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
  
  const lyricsHeightMultiplier = 1;
  const singleRowThreshold = 80;
  const useSingleRow = mode === 'lyrics' ? true : (trackHeight * lyricsHeightMultiplier) < singleRowThreshold;
  const muteBtnWidth = mode === 'lyrics' ? '' : isCompact ? 'w-8 h-8' : 'flex-1';
  
  const [showVoicingChooser, setShowVoicingChooser] = useState(false);
  const customTags = useStore(s => s.customTags);
  const markCustomTagUsed = useStore(s => s.markCustomTagUsed);
  const comboTagSeparator = useStore(s => s.comboTagSeparator);

  const FIXED_TAG_IDS = useMemo(() => new Set(['[ALL]', '[Har]', '[S+A]', '[T+B]']), []);

  const fixedComboTags = useMemo(() => {
    if (mode !== 'lyrics') return [];
    const tracksList = tracks || [];
    const soprano = tracksList.find(t => t.id === '2');
    const alto = tracksList.find(t => t.id === '3');
    const tenor = tracksList.find(t => t.id === '4');
    const bass = tracksList.find(t => t.id === '5');
    const sep = comboTagSeparator;

    return [
      {
        id: '[ALL]', label: 'All', color: getTagColor('[ALL]'),
        trackIds: [], isComposite: false,
      },
      {
        id: '[Har]', label: 'Har', color: getTagColor('[Har]'),
        trackIds: [], isComposite: false,
      },
      {
        id: '[S+A]',
        label: `S${sep}A`,
        color: soprano && alto ? blendColors(soprano.color, alto.color) : '#888',
        trackIds: ['2', '3'], isComposite: true,
      },
      {
        id: '[T+B]',
        label: `T${sep}B`,
        color: tenor && bass ? blendColors(tenor.color, bass.color) : '#888',
        trackIds: ['4', '5'], isComposite: true,
      },
    ];
  }, [tracks, comboTagSeparator, mode]);

  const displayTags = useMemo(() => [...fixedComboTags, ...customTags], [fixedComboTags, customTags]);

  const btnSize = screenSize === 'small' ? smallBtnSize : screenSize === 'medium' ? mediumBtnSize : largeBtnSize;

  const asideRef = useRef<HTMLElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [tracksFit, setTracksFit] = useState(false);

  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const ro = new ResizeObserver(() => {
      const nonMetro = (tracks || []).filter(t => t.id !== 'metronome');
      const cap = btnSize + 6;
      const needTrackH = nonMetro.length * cap;
      const barH = btnSize + 26;
      const result = needTrackH + barH <= aside.clientHeight;
      console.log('=== tracksFit === tracks:', nonMetro.length, 'btnSize:', btnSize, 'cap:', cap, 'need:', needTrackH + barH, 'asideH:', aside.clientHeight, 'result:', result);
      setTracksFit(result);
    });
    ro.observe(aside);
    return () => ro.disconnect();
  }, [tracks, btnSize]);

  const handleTagClick = (tag: { id: string; color: string }) => {
    setActiveTagId(tag.id);
    if (!FIXED_TAG_IDS.has(tag.id)) {
      markCustomTagUsed(tag.id);
    }
  };

  return (
    <>
      {mode === 'lyrics' && isPortrait && screenSize === 'small' ? (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-800 p-1.5">
          <div className="flex flex-row gap-3">
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
                  onClick={() => setActiveTagId(`[${getTrackTagLabel(track)}]`)}
                  className={cn(
                    "rounded font-bold transition-all select-none",
                    getToolbarBtnClass(true),
                    activeTagId === `[${getTrackTagLabel(track)}]` ? "ring-2 ring-white scale-105" : "hover:scale-105"
                  )}
                  style={{ backgroundColor: track.color, color: getContrastColor(track.color) }}
                >
                  {getTrackShortLabel(track, 3)}
                </button>
              </div>
            ))}
            </div>
            <div className="grid grid-cols-3 gap-1 shrink-0 items-start">
              {displayTags.slice(0, 8).map(tag => (
                <button key={tag.id}
                  onClick={() => handleTagClick(tag)}
                  className={cn(
                    "rounded font-bold transition-all select-none",
                    getToolbarBtnClass(true),
                    activeTagId === tag.id ? "ring-2 ring-white scale-105" : "hover:scale-105"
                  )}
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.label}
                </button>
              ))}
              <button key="add-combo"
                onClick={() => setShowVoicingChooser(true)}
                className={cn("rounded font-bold transition-all select-none", getToolbarBtnClass(true), "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}
              >+</button>
            </div>
          </div>
        </div>
      ) : (
        /* Landscape sidebar */
        <div className="flex">
          {/* Combo tags panel (left) - visible when tracks need scrolling */}
          {!tracksFit && mode === 'lyrics' && (
            <div className="bg-zinc-900/30 border-r border-zinc-800 p-1.5 flex flex-col shrink-0 mt-1">
              <div className="grid grid-cols-2 gap-1.5 items-start">
                {fixedComboTags.map(tag => (
                  <button key={tag.id}
                    onClick={() => handleTagClick(tag)}
                    className={cn(
                      "rounded font-bold transition-all select-none",
                      getToolbarBtnClass(true),
                      activeTagId === tag.id ? "ring-2 ring-white scale-105" : "hover:scale-105"
                    )}
                    style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                  >
                    {tag.label}
                  </button>
                ))}
                {customTags.map(tag => (
                  <button key={tag.id}
                    onClick={() => handleTagClick(tag)}
                    className={cn(
                      "rounded font-bold transition-all select-none",
                      getToolbarBtnClass(true),
                      activeTagId === tag.id ? "ring-2 ring-white scale-105" : "hover:scale-105"
                    )}
                    style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                  >
                    {tag.label}
                  </button>
                ))}
                <button key="add-combo"
                  onClick={() => setShowVoicingChooser(true)}
                  style={{ gridColumn: 1 }}
                  className={cn("rounded font-bold transition-all select-none", getToolbarBtnClass(true), "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}
                >+</button>
              </div>
            </div>
          )}

          {/* Track rows sidebar */}
          <aside ref={asideRef} className="bg-zinc-900/30 shrink-0 flex flex-col border-r border-zinc-800 select-none"
            style={{ width: `${btnSize * 3 + 24}px` }}
          >
            {/* Tracks container (scrollable) */}
            <div ref={tracksContainerRef} className="flex flex-col flex-1 overflow-y-auto">
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
                      mode === 'lyrics' ? "pt-0.5 pb-0 px-1.5" : "p-1.5",
                      "transition-all cursor-pointer group relative overflow-hidden border-b border-zinc-800",
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
                        ? "flex flex-row items-center p-1 gap-1"
                        : "flex flex-col"
                    )}>
                      {!isMetronome && (
                        <div className={cn(
                          "flex gap-1",
                          useSingleRow ? "flex-1" : "w-full"
                        )}>
                          <button
                            onClick={() => mode === 'lyrics' ? setActiveTagId(`[${getTrackTagLabel(track)}]`) : useStore.getState().setSelectedTrackId(track.id)}
                            onPointerDown={(e) => mode === 'lyrics' && e.stopPropagation()}
                            className={cn(
                              "rounded flex items-center justify-center font-bold transition-all",
                              mode === 'lyrics' ? getToolbarBtnClass(true) : "w-full h-full text-[10px]",
                              mode === 'lyrics' && (activeTagId === `[${getTrackTagLabel(track)}]` ? "ring-2 ring-white scale-105" : "hover:scale-105")
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
                     
                      {useSingleRow ? (
                        <div className="flex gap-1 flex-1">
                          {isRecording && selectedTrackId === track.id ? (
                            <button
                              onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                              className={cn(
                                "rounded flex items-center justify-center",
                                getToolbarBtnClass(true),
                                "bg-amber-500/20 text-amber-400 border border-amber-500/30",
                                muteBtnWidth
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
                                muteBtnWidth,
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
                                  "rounded flex items-center justify-center transition-colors",
                                  muteBtnWidth,
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
                        <div className={cn("flex gap-1", mode !== 'lyrics' && "p-1")}>
                          {isRecording && selectedTrackId === track.id ? (
                            <button
                              onPointerDown={(e) => handleMutePointerDown(e, track.id)}
                              className={cn(
                                "rounded flex items-center justify-center",
                                muteBtnWidth,
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
                                muteBtnWidth,
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
                                  muteBtnWidth,
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
            </div>

            {/* LVP-style combo bar (inside aside, below tracks) - fills empty vertical space */}
            {tracksFit && mode === 'lyrics' && (
              <div className="border-t border-zinc-800 p-1.5">
                <div className="grid grid-cols-3 gap-1 items-start">
                  {displayTags.slice(0, 8).map(tag => (
                    <button key={tag.id}
                      onClick={() => handleTagClick(tag)}
                      className={cn(
                        "rounded font-bold transition-all select-none",
                        getToolbarBtnClass(true),
                        activeTagId === tag.id ? "ring-2 ring-white scale-105" : "hover:scale-105"
                      )}
                      style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                    >
                      {tag.label}
                    </button>
                  ))}
                  <button key="add-combo"
                    onClick={() => setShowVoicingChooser(true)}
                    className={cn("rounded font-bold transition-all select-none", getToolbarBtnClass(true), "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}
                  >+</button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
      <VoicingChooserModal show={showVoicingChooser} onClose={() => setShowVoicingChooser(false)} />
    </>
  );
};
