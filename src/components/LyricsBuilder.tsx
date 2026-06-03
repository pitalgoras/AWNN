import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { buildTagColorMap, parseLyrics, applyTagToWord, applyTagToSelection, cleanupLyrics, postProcessSpaceColors } from '../lib/lyricsCore';
import { renderRawToDOM, serializeEditor, getSelectedCharRange, setEditorRef, isPaintPending, clearPaintPending, isSectionTagNode, findNextWord } from '../lib/lyricsDOM';
import type { TagPreviewMode } from '../lib/lyricsCore';
import { Anchor, Wand2, Eye, EyeOff, List } from 'lucide-react';
import { VerticalHeatmap } from './VerticalHeatmap';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';

interface Props {
  startRecording: (trackId: string) => void;
  stopRecording: () => void;
}

const TAG_PREVIEW_OPTIONS: { value: TagPreviewMode; label: string }[] = [
  { value: 'chip', label: 'Chip' },
  { value: 'hidden', label: 'Hide' },
  { value: 'full', label: 'Full' },
];

export const LyricsBuilder: React.FC<Props> = ({ startRecording, stopRecording }) => {
  const {
    lyricsText,
    setLyricsText,
    lyricsViewMode,
    setLyricsViewMode,
    activeTagId,
    setActiveTagId,
    currentTime,
    duration,
    tracks,
    isRecording,
    selectedTrackId,
    setSelectedTrackId,
    sectionTags,
    customTags,
    tagPreviewMode,
    setTagPreviewMode,
    isSpreeMode,
    setSpreeMode,
  } = useStore();

  const toolbarContext = useToolbarContext('vertical');
  const isPortrait = toolbarContext.isPortrait;
  const screenSize = toolbarContext.screenSize;

  const lyricsRef = useRef<HTMLDivElement>(null);
  const { getLabel: lyricsGetLabel } = useAdaptiveLabels(
    lyricsRef as React.RefObject<HTMLElement>,
    'vertical',
    8
  );

  const { smallBtnSize, mediumBtnSize, largeBtnSize } = useStore();
  const btnClassBase = screenSize === 'small'
    ? `min-h-[${smallBtnSize}px] p-1 text-[9px]`
    : screenSize === 'medium'
    ? `min-h-[${mediumBtnSize}px] p-1.5 text-[10px]`
    : `min-h-[${largeBtnSize}px] p-2 text-xs`;

  const getBtnClass = (isSquare = false) => cn(btnClassBase, isSquare ? 'aspect-square' : '');
  const btnIconSize = screenSize === 'small' ? 12 : screenSize === 'medium' ? 14 : 16;

  const [showRaw, setShowRaw] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const lastCursorPosRef = useRef(0);

  const PIXELS_PER_SECOND = 20;

  const tagColorMap = useMemo(() => buildTagColorMap(customTags), [customTags]);

  const parsedLines = useMemo(() => {
    const lines = parseLyrics(lyricsText, tagColorMap);
    postProcessSpaceColors(lines);
    return lines;
  }, [lyricsText, tagColorMap]);

  const lastRawRef = useRef(lyricsText);
  useEffect(() => {
    lastRawRef.current = lyricsText;
  }, [lyricsText]);

  useEffect(() => {
    if (!editorRef.current) return;
    setEditorRef(editorRef.current);
    renderRawToDOM(editorRef.current, parsedLines, tagPreviewMode);
    return () => setEditorRef(null);
  }, [parsedLines, tagPreviewMode, showRaw]);

  const handleRecord = async (trackId: string) => {
    if (isRecording) {
      stopRecording();
    } else {
      setSelectedTrackId(trackId);
      startRecording(trackId);
    }
  };

  const handleAnchorLine = (lineStartIndex: number) => {
    const tTag = `[T:${currentTime.toFixed(2)}] `;
    const currentRaw = editorRef.current ? serializeEditor(editorRef.current) : lyricsText;
    const newText = currentRaw.slice(0, lineStartIndex) + tTag + currentRaw.slice(lineStartIndex);
    setLyricsText(newText);
  };

  const insertSectionTag = (tagName: string) => {
    const tTag = `[${tagName}]`;
    const currentRaw = editorRef.current ? serializeEditor(editorRef.current) : lyricsText;
    let cursorPos = -1;
    const range = editorRef.current ? getSelectedCharRange(editorRef.current, false) : null;
    if (range) {
      cursorPos = range.start;
    } else if (currentRaw.length > 0) {
      cursorPos = Math.min(lastCursorPosRef.current, currentRaw.length);
    }
    let newText: string;
    if (cursorPos >= 0) {
      const lineStart = currentRaw.lastIndexOf('\n', cursorPos - 1) + 1;
      const lineEnd = currentRaw.indexOf('\n', cursorPos);
      const lineEndIdx = lineEnd === -1 ? currentRaw.length : lineEnd;
      const beforeCursor = currentRaw.slice(lineStart, cursorPos);
      const afterCursor = currentRaw.slice(cursorPos, lineEndIdx);
      const beforeLine = currentRaw.slice(0, lineStart);
      const afterLine = currentRaw.slice(lineEndIdx);
      newText = beforeLine + beforeCursor + '\n' + tTag + '\n' + afterCursor + afterLine;
    } else {
      newText = tTag + '\n' + currentRaw;
    }
    setLyricsText(newText);
  };

  const handleAutoSync = () => {
    let newText = editorRef.current ? serializeEditor(editorRef.current) : lyricsText;
    let addedOffset = 0;
    parsedLines.forEach((line: any, i: number) => {
      if (line.time === null && line.elements.some((e: any) => e.type === 'word')) {
        const simulatedTime = (i * 2).toFixed(2);
        const tTag = `[T:${simulatedTime}] `;
        const insertPos = line.startIndex + addedOffset;
        newText = newText.slice(0, insertPos) + tTag + newText.slice(insertPos);
        addedOffset += tTag.length;
      }
    });
    const tagMap = buildTagColorMap(customTags);
    setLyricsText(cleanupLyrics(newText, tagMap));
  };

  const handleEditorPointerUp = useCallback((e: React.PointerEvent) => {
    clearPaintPending();
    const store = useStore.getState();
    if (!editorRef.current) return;

    const range = getSelectedCharRange(editorRef.current);
    if (range) lastCursorPosRef.current = range.start;

    if (!store.activeTagId || !store.isSpreeMode || !range) return;

    const currentRaw = serializeEditor(editorRef.current);

    if (isSectionTagNode(editorRef.current)) {
      const closeBracket = currentRaw.indexOf(']', range.end);
      if (closeBracket === -1) return;
      const nextWord = findNextWord(currentRaw, closeBracket + 1);
      if (!nextWord) return;
      const newRaw = applyTagToWord(currentRaw, nextWord.start, nextWord.end, store.activeTagId, tagColorMap);
      const cleaned = cleanupLyrics(newRaw, tagColorMap);
      setLyricsText(cleaned);
      return;
    }

    let newRaw: string;
    if (range.start === range.end) {
      newRaw = applyTagToWord(currentRaw, range.start, range.end, store.activeTagId, tagColorMap);
    } else {
      newRaw = applyTagToSelection(currentRaw, range.start, range.end, store.activeTagId, tagColorMap);
    }

    const cleaned = cleanupLyrics(newRaw, tagColorMap);
    setLyricsText(cleaned);
  }, [tagColorMap, setLyricsText]);

  const handleBlur = useCallback(() => {
    clearPaintPending();
    if (!editorRef.current) return;
    const newRaw = serializeEditor(editorRef.current);
    if (newRaw !== lyricsText) {
      setLyricsText(newRaw);
    }
  }, [lyricsText, setLyricsText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isSpreeMode) {
      e.preventDefault();
      setSpreeMode(false);
    }
  }, [isSpreeMode, setSpreeMode]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const state = useStore.getState();
    if (isPaintPending() && state.activeTagId) {
      clearPaintPending();
      const currentRaw = serializeEditor(editorRef.current);
      const range = getSelectedCharRange(editorRef.current);
      if (range && range.start === range.end) {
        const textBefore = currentRaw.slice(0, range.start);
        const textAfter = currentRaw.slice(range.start);
        const wordStartMatch = textBefore.match(/(\S+)\s*$/);
        const wordEndMatch = textAfter.match(/^(\S+)/);
        const wordStart = wordStartMatch ? range.start - wordStartMatch[1].length : range.start;
        const wordEnd = wordEndMatch ? range.start + wordEndMatch[1].length : range.start;
        if (wordStart < wordEnd) {
          const tagColorMap = buildTagColorMap(state.customTags);
          const newRaw = applyTagToWord(currentRaw, wordStart, wordEnd, state.activeTagId, tagColorMap);
          if (newRaw !== currentRaw) {
            state.setLyricsText(newRaw);
          }
        }
      }
    }
  }, []);

  const cycleTagPreview = () => {
    const modes: TagPreviewMode[] = ['chip', 'hidden', 'full'];
    const idx = modes.indexOf(tagPreviewMode);
    setTagPreviewMode(modes[(idx + 1) % modes.length]);
  };

  const previewModeIcon = tagPreviewMode === 'hidden' ? <EyeOff size={btnIconSize} /> : tagPreviewMode === 'full' ? <List size={btnIconSize} /> : <Eye size={btnIconSize} />;

  return (
    <div className="h-full flex flex-row overflow-hidden bg-zinc-950 text-zinc-200">
      <div
        ref={containerRef}
        className="flex-1 flex flex-row overflow-y-auto relative scroll-smooth min-w-0"
      >
        <VerticalHeatmap scrollContainerRef={containerRef} />

        <div className="w-8 md:w-10 border-l border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-950 relative">
          {parsedLines.map((line: any, idx: number) => (
            <button key={`anchor-${idx}`}
              onPointerDown={(e) => { e.stopPropagation(); handleAnchorLine(line.startIndex); }}
              className={cn("w-full flex items-center justify-center transition-colors relative group",
                lyricsViewMode === 'scaled' ? "absolute min-w-full" : "h-[1.5rem]"
              )}
              style={lyricsViewMode === 'scaled' && line.time !== null ? { top: `${line.time * PIXELS_PER_SECOND}px`, marginTop: '-0.75rem' } : {}}
              title="Anchor line to current playback time"
            >
              <Anchor size={12} className={cn("transition-opacity", line.time !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100 text-zinc-600")} />
            </button>
          ))}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center">
            <button
              onClick={() => setLyricsViewMode(lyricsViewMode === 'scaled' ? 'fixed' : 'scaled')}
              className={cn(
                "p-0.5 px-1 rounded text-[8px] font-bold transition-colors",
                lyricsViewMode === 'scaled' ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              )}
              title="Toggle Scaled vs Fixed layout"
            >
              {lyricsViewMode === 'scaled' ? 'Scaled' : 'Fixed'}
            </button>
          </div>
        </div>

        <div className="flex-1 relative max-w-4xl">
          <div className="flex items-center gap-1.5 p-2 border-b border-zinc-800 bg-zinc-900 flex-wrap">
            {sectionTags.filter(Boolean).map((tag) => (
              <button
                key={tag}
                onPointerDown={(e) => { e.preventDefault(); insertSectionTag(tag); }}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[9px] font-bold uppercase tracking-wider transition-all"
              >
                [{tag}]
              </button>
            ))}
            <div className="flex-1" />
            {isSpreeMode && (
              <span className="text-[9px] font-bold text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded animate-pulse">
                Spree: {activeTagId}
              </span>
            )}
            <button
              onClick={cycleTagPreview}
              className={cn("p-1 rounded transition-colors", "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")}
              title={`Tags: ${tagPreviewMode}`}
            >
              {previewModeIcon}
            </button>
            <button
              onClick={() => setShowRaw(v => !v)}
              className={cn("p-1 rounded transition-colors font-mono text-[9px] font-bold", showRaw ? "bg-yellow-500/20 text-yellow-400" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700")}
              title="Toggle RAW view"
            >
              RAW
            </button>
            <button
              onClick={handleAutoSync}
              className="p-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              title="Auto-sync time tags"
            >
              <Wand2 size={btnIconSize} />
            </button>
          </div>

          {!lyricsText.trim() && (
            <div className="text-zinc-600 text-center mt-20">Click a voice tag in the palette, then click a word to paint it.</div>
          )}

          {showRaw ? (
            <pre className="w-full font-mono text-[11px] leading-relaxed p-6 whitespace-pre-wrap break-all text-zinc-400 outline-none select-text" style={{ minHeight: `${Math.max(duration * PIXELS_PER_SECOND, 200)}px` }}>
              {lyricsText || '(empty)'}
            </pre>
          ) : (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className={cn(
              "w-full font-serif outline-none cursor-text select-text p-6",
              lyricsViewMode === 'scaled' ? "h-full" : ""
            )}
            style={lyricsViewMode === 'scaled' ? { minHeight: `${duration * PIXELS_PER_SECOND}px` } : {}}
            onPointerUp={handleEditorPointerUp}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
          />
          )}
        </div>
      </div>
    </div>
  );
};
