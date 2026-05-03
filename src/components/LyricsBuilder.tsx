import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useStore, VoicingSegment } from '../store/useStore';
import { cn } from '../lib/utils';
import { Palette, AlignLeft, Edit3, Anchor, Wand2, ArrowLeftRight, Mic, VolumeX, Volume2 } from 'lucide-react';
import { VerticalHeatmap } from './VerticalHeatmap';
import { getContrastColor } from '../lib/utils';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';

export const STANDARD_VOICINGS = [
  // Single voices (with trackId) – Right section, two rows with M/R
  { id: '#4a5568', label: 'Accompaniment', tag: '[Acc]', trackId: '1' }, // TODO: Replace all "Backtrack" references later with "Accompaniment"
  { id: '#F6E05E', label: 'Soprano', tag: '[S]', trackId: '2' },
  { id: '#F56565', label: 'Alto', tag: '[A]', trackId: '3' },
  { id: '#48BB78', label: 'Tenor', tag: '[T]', trackId: '4' },
  { id: '#4299E1', label: 'Bass', tag: '[B]', trackId: '5' },

  // Non-single voices (no trackId) – Left section, single row only
  { id: '#A0AEC0', label: 'Unison', tag: '[ALL]', trackId: null },
  { id: '#ED8936', label: 'Soprano & Alto', tag: '[S&A]', trackId: null },
  { id: '#38B2AC', label: 'Tenor & Bass', tag: '[T&B]', trackId: null },
];

export const LyricsBuilder: React.FC = () => {
  const {
    lyricsText,
    setLyricsText,
    lyricsViewMode,
    setLyricsViewMode,
    activeColorId,
    setActiveColorId,
    currentTime,
    duration,
    tracks,
    updateTrack,
    isRecording,
    setIsRecording,
    setSelectedTrackId,
  } = useStore();

  const [isEditMode, setIsEditMode] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  
  const toolbarContext = useToolbarContext('vertical');
  const isPortrait = toolbarContext.isPortrait;
  const screenSize = toolbarContext.screenSize;
  
  const { isAbbreviated: lyricsAbbreviated, getLabel: lyricsGetLabel } = useAdaptiveLabels(
    screenSize,
    { compact: 50, tiny: 30 }
  );
  
  // Responsive sizing based on screenSize
  const { smallBtnSize, mediumBtnSize, largeBtnSize } = useStore();
  const btnClassBase = screenSize === 'small' 
    ? `min-h-[${smallBtnSize}px] p-1 text-[9px]`
    : screenSize === 'medium' 
    ? `min-h-[${mediumBtnSize}px] p-1.5 text-[10px]`
    : `min-h-[${largeBtnSize}px] p-2 text-xs`;
  
  const getBtnClass = (isSquare = false) => cn(btnClassBase, isSquare ? 'aspect-square' : '');
  const btnIconSize = screenSize === 'small' ? 12 : screenSize === 'medium' ? 14 : 16;
  
  // Palette voicing buttons: small fixed size, not full-width
  const paletteBtnSize = screenSize === 'small' ? 'h-8 w-8 min-h-0 text-[9px]' : 'h-10 w-10 min-h-0 text-[10px]';
  // M/R buttons below voices: compact size
  const smallBtnClass = screenSize === 'small' ? 'h-6 px-2 text-[9px]' : 'h-7 px-2 text-[10px]';
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Use a PIXELS_PER_SECOND constant, same as VerticalHeatmap
  const PIXELS_PER_SECOND = 20;

  // Sync scroll with playback time ONLY if user allows it (for now, simply let users scroll freely, or if we want lock-to-playhead we can do that. User said "allow text scrolling with 2 finger on desktop and drag on mobile keeping stripes in sync", so they MUST be in the same scroll container).

  // Parse text into lines, words, and tags
  const parsedLines = useMemo(() => {
    const list: any[] = [];
    let currentLine: any = { id: 0, time: null, elements: [], startIndex: 0 };
    let currentVoiceColor = 'transparent';
    let charIndex = 0;

    // Tokenize: TimeTags, VoiceTags, Newlines, Words, Whitespace
    const regex = /(\[T:\d+(\.\d+)?\])|(\[(ALL|S|A|T|B|S&A|T&B)\])|(\n)|([^\s\[\]\n]+)|([ \t]+)/g;
    let match;

    while ((match = regex.exec(lyricsText)) !== null) {
      const matchText = match[0];
      const startChar = match.index;
      const endChar = match.index + matchText.length;

      if (match[1]) {
        // Time Tag
        const timeMatch = match[1].match(/\[T:(\d+(\.\d+)?)\]/);
        if (timeMatch) currentLine.time = parseFloat(timeMatch[1]);
        
        currentLine.elements.push({ type: 'time-tag', text: matchText, startChar, endChar, time: currentLine.time });
      } else if (match[3]) {
        // Voice Tag
        const vId = STANDARD_VOICINGS.find(v => v.tag === match[3])?.id;
        if (vId) currentVoiceColor = vId;
        
        currentLine.elements.push({ type: 'voice-tag', text: matchText, startChar, endChar, colorId: currentVoiceColor });
      } else if (match[5]) {
        // Newline
        currentLine.endIndex = endChar;
        list.push(currentLine);
        currentLine = { id: list.length, time: null, elements: [], startIndex: endChar };
      } else if (match[6]) {
        // Word
        currentLine.elements.push({ type: 'word', text: matchText, startChar, endChar, colorId: currentVoiceColor });
      } else if (match[7]) {
        // Whitespace (keep it for alignment/spacing)
        // Let's color the whitespace with the CURRENT voice color so sentences look continuous
        currentLine.elements.push({ type: 'space', text: matchText, startChar, endChar, colorId: currentVoiceColor });
      }
      charIndex = endChar;
    }
    
    currentLine.endIndex = charIndex;
    list.push(currentLine);

    return list;
  }, [lyricsText]);

  const setLyricsCleanText = (text: string) => {
    // Basic cleanup logic: remove consecutive duplicate tags, enforce one time tag per line
    let cleaned = text;
    
    // Process line by line for T tags
    cleaned = cleaned.split('\n').map(line => {
      // Find all T tags
      const tTags = line.match(/\[T:\d+(\.\d+)?\]/g);
      if (tTags && tTags.length > 1) {
        // Keep only the first one
        let first = true;
        return line.replace(/\[T:\d+(\.\d+)?\]/g, (match) => {
          if (first) {
            first = false;
            return match;
          }
          return '';
        });
      }
      return line;
    }).join('\n');

    // Rule: [ALL] overwrites others nearby (simplification)
    cleaned = cleaned.replace(/\[(S|A|T|B|S&A|T&B)\]\s*\[ALL\]/g, '[ALL]');
    cleaned = cleaned.replace(/\[ALL\]\s*\[(S|A|T|B|S&A|T&B)\]/g, '[ALL]');
    
// Rule: remove duplicate voicing tags with text between them (line-by-line)
     cleaned = cleaned.split('\n').map(line => {
       let lastTag = null;
       return line.replace(/\[(ALL|S|A|T|B|S&A|T&B)\]/g, (match, tag) => {
         if (tag === lastTag) return ''; // Remove duplicate
         lastTag = tag;
         return match;
       });
     }).join('\n');
    
    // Rule: if multiple conflicting voices, just keep the last painted one (this is tricky to regex perfectly, but we'll prune obvious ones)
    // E.g. [S] [A] -> [A]
    cleaned = cleaned.replace(/(\[(S|A|T|B|S&A|T&B|ALL)\]\s*)+\[(S|A|T|B|S&A|T&B|ALL)\]/g, (match, p1, p2, p3) => {
      // Return just the last tag in the sequence
      const tags = match.match(/\[.*?\]/g);
      const lastTag = tags ? tags[tags.length - 1] : match;
      return lastTag + ' ';
    });

    setLyricsText(cleaned);
  };

// Handle Paint bucket click/drag on a word
const handleWordInteraction = (startChar: number, endChar: number) => {
  if (isEditMode) return;
  
  // Get target tag from active color
  const voiceObj = STANDARD_VOICINGS.find(v => v.id === activeColorId) || STANDARD_VOICINGS[0];
  const targetTag = voiceObj.tag; // e.g., "[S]"
  
  // Step 1: Scan backward from startChar to find nearest [TAG] or SOF
  const textBefore = lyricsText.slice(0, startChar);
  const tagRegex = /\[(ALL|S|A|T|B|S&A|T&B)\]/g;
  let match;
  let lastTagMatch = null;
  
  while ((match = tagRegex.exec(textBefore)) !== null) {
    lastTagMatch = match; // Last match is closest to startChar
  }
  
  const currentTag = lastTagMatch ? lastTagMatch[0] : null;
  const currentTagIndex = lastTagMatch ? lastTagMatch.index : -1;
  
  // Step 2: If current tag is same as target, do nothing (no duplicate)
  if (currentTag === targetTag) {
    return;
  }
  
  // Step 3: If current tag exists and is different, replace it with target tag
  if (currentTag) {
    const beforeTag = lyricsText.slice(0, currentTagIndex);
    const afterTag = lyricsText.slice(currentTagIndex + currentTag.length);
    const newText = beforeTag + targetTag + afterTag;
    setLyricsCleanText(newText);
    return;
  }
  
  // Step 4: No current tag (default [ALL]), insert new tag before word
  const tagToInsert = targetTag + ' ';
  setLyricsCleanText(lyricsText.slice(0, startChar) + tagToInsert + lyricsText.slice(startChar));
};

  // Handle Anchor drop
  const handleAnchorLine = (lineStartIndex: number) => {
    const tTag = `[T:${currentTime.toFixed(2)}] `;
    
    // Remove old T tags from the line before adding the new one
    const newText = lyricsText;
    
    // We can do a string manipulation specifically for this line
    setLyricsCleanText(newText.slice(0, lineStartIndex) + tTag + newText.slice(lineStartIndex));
  };

  const handleAutoSync = () => {
    let newText = lyricsText;
    let addedOffset = 0;
    parsedLines.forEach((line: any, i: number) => {
      if (line.time === null && line.elements.some((e:any) => e.type === 'word')) {
        const simulatedTime = (i * 2).toFixed(2);
        const tTag = `[T:${simulatedTime}] `;
        const insertPos = line.startIndex + addedOffset;
        newText = newText.slice(0, insertPos) + tTag + newText.slice(insertPos);
        addedOffset += tTag.length;
      }
    });
    setLyricsCleanText(newText);
  };

  // The user says "on text edit, the [T:time] labels must not show."
  // If we strip them for the textarea, they will be removed from state.
  // "let's develop the logic as cases arise."
  const editTextValue = useMemo(() => {
    return lyricsText.replace(/\[T:\d+(\.\d+)?\]\s?/g, '');
  }, [lyricsText]);

  const handleEditTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // The user edits the text stripped of [T:xx] tags.
    // We attempt to preserve the time tags by mapping them back line-by-line.
    const newTextRaw = e.target.value;
    const newLines = newTextRaw.split('\n');
    const oldLines = lyricsText.split('\n');

    const mergedText = newLines.map((newLine, i) => {
      const oldLine = oldLines[i] || '';
      const tMatch = oldLine.match(/(\[T:\d+(\.\d+)?\]\s*)/);
      const tTag = tMatch ? tMatch[0] : '';
      return tTag + newLine;
    }).join('\n');

    setLyricsCleanText(mergedText);
  };

  return (
    <div className="flex-1 flex flex-row overflow-hidden bg-zinc-950 text-zinc-200">
       
      {/* LEFT MARGIN TOOLBAR - Split into Left/Right sections */}
      <div className={cn(
        "border-t border-zinc-800 p-1 gap-1",
        isPortrait && screenSize === 'small'
          ? "fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 flex-row" // Bottom bar, horizontal
          : "w-56 flex-col items-start overflow-y-auto" // Left sidebar
      )}>
        {!isPortrait && <Palette size={14} className="text-zinc-500 mb-1 self-center" />}
        
        {/* Split voicings into left (non-single) and right (single) */}
        {(() => {
          const nonSingleVoicings = STANDARD_VOICINGS.filter(v => !v.trackId);
          const singleVoicings = STANDARD_VOICINGS.filter(v => v.trackId);
          
          return (
            <>
              {/* Left Section: Non-single voices (top-aligned, single row, no M/R) */}
              <div className={cn(
                "flex gap-1",
                isPortrait && screenSize === 'small' 
                  ? "flex-1 justify-start items-center" // Bottom bar: horizontal, top-aligned
                  : "flex-1 flex-col justify-start w-full", // Sidebar: vertical, top-aligned
                "py-1"
              )}>
                {nonSingleVoicings.map(v => {
                  const contrastColor = getContrastColor(v.id);
                  return (
                    <div key={v.id} className="flex items-center justify-center">
                      <button
                        onClick={() => setActiveColorId(v.id)}
                        className={cn(
                          "rounded-full border-2 transition-transform shadow-sm flex items-center justify-center",
                          paletteBtnSize,
                          activeColorId === v.id ? "scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)] z-10" : "scale-90 border-transparent hover:scale-100 opacity-60 hover:opacity-100"
                        )}
                        style={{
                          backgroundColor: v.id,
                          color: contrastColor,
                          borderColor: activeColorId === v.id ? '#fff' : 'transparent'
                        }}
                        title={v.label}
                      >
                        {v.tag}
                      </button>
                    </div>
                  );
                })}
              </div>
              
              {/* Divider between sections */}
              <div className={cn(
                "bg-zinc-800",
                isPortrait && screenSize === 'small' ? "w-px h-full mx-1" : "w-full h-px my-1"
              )} />
              
              {/* Right Section: Single voices (two rows: voice → M/R) */}
              <div className={cn(
                "flex gap-1",
                isPortrait && screenSize === 'small'
                  ? "flex-1 justify-start items-start flex-wrap" // Bottom bar: horizontal wrap
                  : "flex-1 flex-col w-full", // Sidebar: vertical
                "py-1"
              )}>
                {singleVoicings.map(v => {
                  const track = v.trackId ? tracks.find(t => t.id === v.trackId) : null;
                  const contrastColor = getContrastColor(v.id);
                  
                  return (
                    <div key={v.id} className={cn(
                      "flex gap-1",
                      track 
                        ? "flex-col" // Two rows: voice button → mute/record below
                        : "flex-row items-center"
                    )}>
                      {/* Voice button - label inside */}
                      <button
                        onClick={() => setActiveColorId(v.id)}
                        className={cn(
                          "rounded-full border-2 transition-transform shadow-sm flex items-center justify-center",
                          paletteBtnSize,
                          activeColorId === v.id ? "scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)] z-10" : "scale-90 border-transparent hover:scale-100 opacity-60 hover:opacity-100"
                        )}
                        style={{
                          backgroundColor: v.id,
                          color: contrastColor,
                          borderColor: activeColorId === v.id ? '#fff' : 'transparent'
                        }}
                        title={v.label}
                      >
                        {v.tag}
                      </button>
                   
                      {/* Mute & Record buttons - BELOW voice button */}
                      {track && (
                        <div className="flex flex-col gap-1 w-full">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              updateTrack(track.id, { isMuted: !track.isMuted });
                            }}
                            className={cn(
                              "rounded flex items-center justify-center text-[10px] font-bold transition-all",
                              smallBtnClass,
                              track.isMuted 
                                ? "bg-red-500/20 text-red-400" 
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                            )}
                            title="Toggle Mute"
                          >
                            M
                          </button>
                          {v.trackId !== '1' && !isRecording && useStore.getState().selectedTrackId !== track?.id && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleRecord(track.id); }}
                              className={cn(
                                "rounded flex items-center justify-center transition-colors",
                                smallBtnClass,
                                "bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-300"
                              )}
                              title="Record"
                            >
                              R
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>
      
      {/* Main Workspace: Syncing container with 2-finger scroll */}
      <div 
        ref={containerRef}
        className={cn(
          "flex-1 flex flex-row overflow-y-auto relative scroll-smooth",
          isEditMode && "overflow-hidden" // Hide scroll if edit mode uses full screen textarea
        )}
      >
        {/* Floating Edit Text button when not in edit mode */}
        {!isEditMode && (
          <button
            onClick={() => setIsEditMode(true)}
            className={cn(
              "fixed top-4 left-4 z-50 flex items-center gap-1 shadow-lg",
              getBtnClass(false),
              "rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700"
            )}
            title="Edit Lyrics Text"
          >
            <Edit3 size={btnIconSize} />
            <span className={screenSize === 'small' ? 'text-[9px]' : screenSize === 'medium' ? 'text-[10px]' : 'text-xs'}>{lyricsGetLabel('Edit Text', 'Edit')}</span>
          </button>
        )}
        
        {/* Floating Done button in edit mode */}
        {isEditMode && (
          <button
            onClick={() => setIsEditMode(false)}
            className={cn(
              "fixed top-4 left-4 z-50 flex items-center gap-1 shadow-lg",
              getBtnClass(false),
              "rounded-lg bg-zinc-100 text-zinc-900"
            )}
            title="Finish Editing"
          >
            <Edit3 size={btnIconSize} />
            <span className={screenSize === 'small' ? 'text-[9px]' : screenSize === 'medium' ? 'text-[10px]' : 'text-xs'}>{lyricsGetLabel('Done', '✓')}</span>
          </button>
        )}
        
        {/* Heatmap Layer */}
        {!isEditMode && <VerticalHeatmap scrollContainerRef={containerRef} />}

        {/* Anchor Stripe */}
        {!isEditMode && (
          <div className="w-8 md:w-10 border-l border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-950 relative">
             {parsedLines.map((line: any, idx: number) => (
                <div key={`anchor-${idx}`} className={cn("text-xs flex items-center justify-center relative group", lyricsViewMode === 'scaled' ? "absolute min-w-full" : "h-[1.5rem]")}
                     style={lyricsViewMode === 'scaled' && line.time !== null ? { top: `${line.time * PIXELS_PER_SECOND}px`, marginTop: '-0.75rem' } : {}}
                >
                  <div className={cn("transition-opacity", line.time !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                    <ArrowLeftRight size={12} className="text-zinc-600" />
                  </div>
                </div>
              ))}

             {/* Fixed/Scaled toggle at bottom of stripe */}
             <div className="absolute bottom-2 left-0 right-0 flex justify-center">
               <button
                 onClick={() => setLyricsViewMode(lyricsViewMode === 'scaled' ? 'fixed' : 'scaled')}
                 className={cn(
                   "p-0.5 px-1 rounded text-[8px] font-bold transition-colors",
                   lyricsViewMode === 'scaled' ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                 )}
                 title="Toggle Scaled (Absolute Time) vs Fixed layout"
               >
                 {lyricsViewMode === 'scaled' ? 'Scaled' : 'Fixed'}
               </button>
             </div>
          </div>
        )}

        {/* Lyrics Editor / Canvas */}
        <div className={cn("flex-1 max-w-4xl", isEditMode ? "p-6" : "relative")}>
          {isEditMode ? (
            <textarea
              className="w-full h-full min-h-[500px] bg-zinc-950 border border-zinc-800 rounded p-6 text-sm md:text-base font-serif text-zinc-200 outline-none resize-none leading-loose"
              placeholder="Paste or type lyrics here... \nUse [ALL], [S], [A], [T], [B] to tag voicings."
              value={editTextValue}
              onChange={handleEditTextChange}
            />
          ) : (
            <div 
              className={cn("w-full font-serif cursor-crosshair select-none", lyricsViewMode === 'scaled' ? "h-full" : "p-6")}
              style={lyricsViewMode === 'scaled' ? { minHeight: `${duration * PIXELS_PER_SECOND}px` } : {}}
              onMouseDown={() => setIsPainting(true)}
              onMouseUp={() => setIsPainting(false)}
              onMouseLeave={() => setIsPainting(false)}
            >
              {!lyricsText.trim() && (
                <div className="text-zinc-600 text-center mt-20">Click 'Edit Text' to add lyrics.</div>
              )}
              
              {parsedLines.map((line: any, idx: number) => {
                if (line.elements.length === 0) return null;
                
                return (
                  <div 
                    key={`line-${idx}`} 
                    className={cn(
                      "flex flex-wrap items-center group/line min-h-0",
                      lyricsViewMode === 'scaled' ? "absolute right-6 left-12 md:left-24" : "relative mb-0",
                      lyricsViewMode === 'fixed' && "leading-[1.5rem]"
                    )}
                    // Calculate Y position based on time marker if in scaled mode
                    style={lyricsViewMode === 'scaled' && line.time !== null ? { top: `${line.time * PIXELS_PER_SECOND}px`, marginTop: '-0.75rem' } : {}}
                  >
                    {/* Anchor Button */}
                    <button 
                      onMouseDown={(e) => { e.stopPropagation(); handleAnchorLine(line.startIndex); }}
                      className={cn(
                        "absolute -left-10 opacity-0 group-hover/line:opacity-100 transition-all bg-zinc-800 rounded-full shadow-lg",
                        getBtnClass(true)
                      )}
                      title="Anchor line to current playback time"
                    >
                      <Anchor size={btnIconSize} />
                    </button>
                    
                    {line.time !== null && (
                      <span className="absolute -left-[4.5rem] text-[9px] font-mono text-zinc-600 mt-1 hidden md:block">
                        {line.time.toFixed(1)}s
                      </span>
                    )}

                    {line.elements.map((el: any, eIdx: number) => {
                      if (el.type === 'time-tag') {
                        return null; // hide time-tags from UI display
                      }
                      
                      // Render Voice Tags (Hidden by default based on spec)
                      if (el.type === 'voice-tag') {
                        return null;
                      }
                      
                      const isPainted = el.colorId && el.colorId !== 'transparent';
                      
                      // For spaces, we apply the background color but no text shadow
                      if (el.type === 'space') {
                        return (
                          <span 
                            key={`el-${idx}-${eIdx}`} 
                            className="inline-block whitespace-pre transition-colors h-[1.5rem] leading-[1.5rem] align-top"
                            style={{ backgroundColor: isPainted ? el.colorId : 'transparent' }}
                          >
                            {el.text}
                          </span>
                        );
                      }
                      
                      return (
                        <span
                          key={`el-${idx}-${eIdx}`}
                          onMouseDown={() => handleWordInteraction(el.startChar, el.endChar)}
                          onMouseEnter={() => { if (isPainting) handleWordInteraction(el.startChar, el.endChar) }}
                          className={cn(
                            "inline-block transition-colors cursor-pointer text-sm md:text-base h-[1.5rem] leading-[1.5rem] align-top",
                            !isPainted && "hover:bg-zinc-800"
                          )}
                          style={{
                            backgroundColor: el.colorId,
                            color: isPainted ? '#fff' : 'inherit',
                          }}
                        >
                          {el.text}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
