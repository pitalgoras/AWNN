import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { cn, TAG_COLOR_MAP, getContrastColor } from '../lib/utils';
import { AlignLeft, Anchor, Wand2, ArrowLeftRight, Mic, Edit3 } from 'lucide-react';
import { VerticalHeatmap } from './VerticalHeatmap';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';




interface Props {
  isEditMode: boolean;
  setIsEditMode: (v: boolean) => void;
  startRecording: (trackId: string) => void;
  stopRecording: () => void;
}

export const LyricsBuilder: React.FC<Props> = ({ isEditMode, setIsEditMode, startRecording, stopRecording }) => {
  const {
    lyricsText,
    setLyricsText,
    lyricsViewMode,
    setLyricsViewMode,
    activeTagId,
    currentTime,
    duration,
    tracks,
    updateTrack,
    isRecording,
    setIsRecording,
    setSelectedTrackId,
    selectedTrackId,
    sectionTags,
    customTags,
  } = useStore();

  const [isPainting, setIsPainting] = useState(false);

  const toolbarContext = useToolbarContext('vertical');
  const isPortrait = toolbarContext.isPortrait;
  const screenSize = toolbarContext.screenSize;
  
  // Toolbar ref for adaptive labels
  const lyricsRef = useRef<HTMLDivElement>(null);
  // Approximate item count: Palette, Align, Edit, Anchor, Wand, Arrows, Mic, Volume = 8
  const { isAbbreviated: lyricsAbbreviated, getLabel: lyricsGetLabel } = useAdaptiveLabels(
    lyricsRef as React.RefObject<HTMLElement>,
    'vertical',
    8
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
  
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Handle record button click
  const handleRecord = async (trackId: string) => {
    if (isRecording) {
      stopRecording();
    } else {
      setSelectedTrackId(trackId);
      startRecording(trackId);
    }
  };
  
  // Use a PIXELS_PER_SECOND constant, same as VerticalHeatmap
  const PIXELS_PER_SECOND = 20;

  // Sync scroll with playback time ONLY if user allows it (for now, simply let users scroll freely, or if we want lock-to-playhead we can do that. User said "allow text scrolling with 2 finger on desktop and drag on mobile keeping stripes in sync", so they MUST be in the same scroll container).

  // Build a dynamic tag→color map from static tags + custom combos
  const tagColorMap = useMemo(() => {
    const map: Record<string, string> = { ...TAG_COLOR_MAP };
    for (const ct of customTags) {
      map[ct.id] = ct.color;
    }
    return map;
  }, [customTags]);

  const isVoicingTag = (tagText: string): boolean => tagColorMap[tagText] !== undefined;

  // Parse text into lines, words, and tags
  const parsedLines = useMemo(() => {
    const list: any[] = [];
    let currentLine: any = { id: 0, time: null, elements: [], startIndex: 0 };
    let currentVoiceColor = 'transparent';
    let charIndex = 0;

    // Tokenize: TimeTags, VoiceTags, SectionTags, Newlines, Words, Whitespace
    const regex = /(\[T:\d+(\.\d+)?\])|(\[(ALL|S|A|T|B|Acc|S[+&]A|T[+&]B)\])|(\[[A-Za-z][A-Za-z0-9\s\-+&]*?\])|(\n)|([^\s\[\]\n]+)|([ \t]+)/g;
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
        // Voice Tag (fast path for known tags)
        const vId = tagColorMap[match[0]];
        if (vId) currentVoiceColor = vId;
        
        currentLine.elements.push({ type: 'voice-tag', text: matchText, startChar, endChar, colorId: currentVoiceColor });
      } else if (match[5]) {
        // Catch-all bracket tag — could be voicing tag ([Har], custom combo) or section tag
        const vId = tagColorMap[matchText];
        if (vId) {
          currentVoiceColor = vId;
          currentLine.elements.push({ type: 'voice-tag', text: matchText, startChar, endChar, colorId: currentVoiceColor });
        } else {
          currentLine.elements.push({ type: 'section-tag', text: matchText, startChar, endChar });
        }
      } else if (match[6]) {
        // Newline
        currentLine.endIndex = endChar;
        list.push(currentLine);
        currentLine = { id: list.length, time: null, elements: [], startIndex: endChar };
      } else if (match[7]) {
        // Word
        currentLine.elements.push({ type: 'word', text: matchText, startChar, endChar, colorId: currentVoiceColor });
      } else if (match[8]) {
        // Whitespace (keep it for alignment/spacing)
        // Let's color the whitespace with the CURRENT voice color so sentences look continuous
        currentLine.elements.push({ type: 'space', text: matchText, startChar, endChar, colorId: currentVoiceColor });
      }
      charIndex = endChar;
    }
    
    currentLine.endIndex = charIndex;
    list.push(currentLine);

    return list;
  }, [lyricsText, tagColorMap]);

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
    cleaned = cleaned.replace(/(\[[^\]]+\])\s*\[ALL\]/g, (match, tag) => {
      if (tag !== '[ALL]' && isVoicingTag(tag)) return '[ALL]';
      return match;
    });
    cleaned = cleaned.replace(/\[ALL\]\s*(\[[^\]]+\])/g, (match, tag) => {
      if (tag !== '[ALL]' && isVoicingTag(tag)) return '[ALL]';
      return match;
    });
    
 // Rule: remove duplicate voicing tags with text between them (line-by-line)
     cleaned = cleaned.split('\n').map(line => {
       let lastTag: string | null = null;
       return line.replace(/\[[^\]]+\]/g, (match) => {
         if (!isVoicingTag(match)) return match;
         if (match === lastTag) return '';
         lastTag = match;
         return match;
       });
     }).join('\n');
    
    // Rule: if multiple conflicting voices, just keep the last painted one (this is tricky to regex perfectly, but we'll prune obvious ones)
    // E.g. [S] [A] -> [A]
    cleaned = cleaned.replace(/(\[[^\]]+\]\s*)+\[[^\]]+\]/g, (match) => {
      // Return just the last voicing tag in the sequence
      const tags = match.match(/\[.*?\]/g) || [];
      const voicingTags = tags.filter(t => isVoicingTag(t));
      if (voicingTags.length <= 1) return match;
      return voicingTags[voicingTags.length - 1] + ' ';
    });

    setLyricsText(cleaned);
  };

// Handle Paint bucket click/drag on a word
const handleWordInteraction = (startChar: number, endChar: number) => {
  if (isEditMode) return;

  const targetTag = activeTagId;

  // Helper: scan forward from a position and remove all targetTag occurrences until a different voicing tag appears
  const removeForwardDuplicates = (text: string, fromIndex: number): string => {
    const voicingTagPattern = /\[[^\]]+\]/g;
    let output = text.slice(0, fromIndex);
    let rest = text.slice(fromIndex);
    let match: RegExpExecArray | null;
    while ((match = voicingTagPattern.exec(rest)) !== null) {
      if (!isVoicingTag(match[0])) continue;
      const matchedTag = match[0];
      if (matchedTag === targetTag) {
        // Remove this tag: skip it
        output += rest.slice(0, match.index);
        rest = rest.slice(match.index + matchedTag.length);
        voicingTagPattern.lastIndex = 0; // reset because we modified rest
        continue;
      } else {
        // Different tag encountered, stop
        break;
      }
    }
    output += rest;
    return output;
  };

  // 1. Backward scan for nearest voicing tag V
  const textBefore = lyricsText.slice(0, startChar);
  const tagRegex = /\[[^\]]+\]/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(textBefore)) !== null) {
    if (!isVoicingTag(m[0])) continue;
    lastMatch = m;
  }
  const V = lastMatch ? lastMatch[0] : null;
  const VIndex = lastMatch ? lastMatch.index : -1;

  // 2. Determine if V is "right before" the word
  let isRightBefore = false;
  if (V) {
    const afterV = lyricsText.slice(VIndex + V.length, startChar);
    // Remove non-voicing tags (like [T:...]) for checking
    const cleaned = afterV.replace(/\[T:\d+(\.\d+)?\]/g, '');
    // Check if cleaned contains any non-whitespace
    const hasText = /\S/.test(cleaned);
    // Check if there is any voicing tag in afterV (should not happen, but just in case)
    const hasVoicing = afterV.match(/\[[^\]]+\]/g)?.some(t => isVoicingTag(t)) ?? false;
    isRightBefore = !hasText && !hasVoicing;
  }

  // 3. Compare V and targetTag
  let newText = lyricsText;
  if (V && V === targetTag) {
    // Same tag: do nothing for backward part, but forward scan after the word
    newText = removeForwardDuplicates(lyricsText, endChar);
    setLyricsCleanText(newText);
    return;
  } else if (V && V !== targetTag) {
    if (isRightBefore) {
      // Replace V with targetTag
      newText = lyricsText.slice(0, VIndex) + targetTag + lyricsText.slice(VIndex + V.length);
      // Forward scan from after the word (endChar unchanged because replacement before word)
      newText = removeForwardDuplicates(newText, endChar);
    } else {
      // Insert targetTag at startChar
      const toInsert = targetTag + ' ';
      newText = lyricsText.slice(0, startChar) + toInsert + lyricsText.slice(startChar);
      // Forward scan from after the inserted tag + word
      const newEndChar = endChar + toInsert.length;
      newText = removeForwardDuplicates(newText, newEndChar);
    }
  } else {
    // No V (default ALL) -> insert targetTag at startChar
    const toInsert = targetTag + ' ';
    newText = lyricsText.slice(0, startChar) + toInsert + lyricsText.slice(startChar);
    const newEndChar = endChar + toInsert.length;
    newText = removeForwardDuplicates(newText, newEndChar);
  }

  setLyricsCleanText(newText);
};

  // Handle Anchor drop
  const handleAnchorLine = (lineStartIndex: number) => {
    const tTag = `[T:${currentTime.toFixed(2)}] `;
    
    // Remove old T tags from the line before adding the new one
    const newText = lyricsText;
    
    // We can do a string manipulation specifically for this line
    setLyricsCleanText(newText.slice(0, lineStartIndex) + tTag + newText.slice(lineStartIndex));
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertSectionTag = (tagName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentEditText = textarea.value;
    const newEditText = currentEditText.slice(0, start) + `[${tagName}]\n` + currentEditText.slice(end);
    handleEditTextChange({ target: { value: newEditText } } as React.ChangeEvent<HTMLTextAreaElement>);
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
       

      
      {/* Main Workspace: Syncing container with 2-finger scroll */}
      <div 
        ref={containerRef}
        className={cn(
          "flex-1 flex flex-row overflow-y-auto relative scroll-smooth",
          isEditMode && "overflow-hidden" // Hide scroll if edit mode uses full screen textarea
        )}
      >
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
        <div className={cn("flex-1 max-w-4xl", isEditMode ? "p-6 h-full" : "relative")}>
          {!isPortrait && !isEditMode && (
            <button onClick={() => setIsEditMode(true)}
              className="absolute top-2 right-2 z-10 flex items-center gap-1 px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider bg-zinc-800 text-white hover:bg-zinc-700 shadow-sm"
              title="Edit Lyrics Text"
            >
              <Edit3 size={14} /> Edit
            </button>
          )}
          {!isPortrait && isEditMode && (
            <button onClick={() => setIsEditMode(false)}
              className="absolute top-2 right-2 z-10 flex items-center gap-1 px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider bg-zinc-100 text-zinc-900 shadow-sm"
              title="Finish Editing"
            >
              <Edit3 size={14} /> Done
            </button>
          )}
          {isEditMode ? (
            <div className="flex flex-col h-full">
              <div className="flex flex-wrap gap-1.5 p-3 border-b border-zinc-800 bg-zinc-900">
                {sectionTags.filter(Boolean).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => insertSectionTag(tag)}
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[9px] font-bold uppercase tracking-wider transition-all"
                  >
                    [{tag}]
                  </button>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="flex-1 w-full bg-zinc-950 border border-zinc-800 rounded p-6 text-sm md:text-base font-serif text-zinc-200 outline-none resize-none leading-loose"
                placeholder="Paste or type lyrics here...\nUse [ALL], [S], [A], [T], [B] to tag voicings."
                value={editTextValue}
                onChange={handleEditTextChange}
              />
            </div>
          ) : (
            <div 
              className={cn("w-full font-serif cursor-crosshair select-none", lyricsViewMode === 'scaled' ? "h-full" : "p-6")}
              style={lyricsViewMode === 'scaled' ? { minHeight: `${duration * PIXELS_PER_SECOND}px` } : {}}
              onPointerDown={() => setIsPainting(true)}
              onPointerUp={() => setIsPainting(false)}
              onPointerLeave={() => setIsPainting(false)}
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
                      onPointerDown={(e) => { e.stopPropagation(); handleAnchorLine(line.startIndex); }}
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
                      
                      // Render Section Tags as styled headers
                      if (el.type === 'section-tag') {
                        const name = el.text.slice(1, -1); // strip brackets
                        return (
                          <span
                            key={`el-${idx}-${eIdx}`}
                            className="w-full block text-[10px] font-bold text-zinc-500 italic uppercase tracking-[0.15em] mb-1 mt-2 select-none"
                          >
                            {name}
                          </span>
                        );
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
                          onPointerDown={() => handleWordInteraction(el.startChar, el.endChar)}
                          onPointerEnter={() => { if (isPainting) handleWordInteraction(el.startChar, el.endChar) }}
                          className={cn(
                            "inline-block transition-colors cursor-pointer text-sm md:text-base h-[1.5rem] leading-[1.5rem] align-top",
                            !isPainted && "hover:bg-zinc-800"
                          )}
                          style={{
                            backgroundColor: el.colorId,
                            color: isPainted ? getContrastColor(el.colorId) : 'inherit',
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
