import React, { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { FileText, Mic, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToolbarContext } from '../hooks/useToolbarContext';
import { useAdaptiveLabels } from '../hooks/useAdaptiveLabels';

// Temporary color palette (matches track colors)
const VOICE_PALETTE = [
  { id: 'soprano', label: 'S', color: '#F6E05E', trackIndex: 2 },
  { id: 'alto', label: 'A', color: '#F56565', trackIndex: 3 },
  { id: 'tenor', label: 'T', color: '#48BB78', trackIndex: 4 },
  { id: 'bass', label: 'B', color: '#4299E1', trackIndex: 5 },
  { id: 'unison', label: 'U', color: '#FACC15', trackIndex: null },
  { id: 'harmony', label: 'H', color: '#F97316', trackIndex: null },
];

export default function LyricsBuilderView() {
  const tracks = useStore(s => s.tracks);
  const [lyrics, setLyrics] = useState('');
  const [showTags, setShowTags] = useState(true);
  const [selectedColor, setSelectedColor] = useState(VOICE_PALETTE[0].id);
  const [viewMode, setViewMode] = useState<'fixed' | 'scaled'>('scaled');

  // Adaptive Toolbar Hooks
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lyricsContext = useToolbarContext('horizontal');
  const { isAbbreviated: lyricsAbbreviated, getLabel: lyricsLabel } = useAdaptiveLabels(
    lyricsRef as React.RefObject<HTMLElement>,
    'horizontal',
    4 // Approximate item count: Fixed, Scaled, Eye toggle, Publish
  );
  
  // Responsive sizing based on screenSize
  const lyricsScreenSize = lyricsContext.screenSize;
  const { smallBtnSize, mediumBtnSize, largeBtnSize } = useStore();
  const lyricsBtnSize = lyricsScreenSize === 'small' 
    ? `min-h-[${smallBtnSize}px] p-1 text-[9px]`
    : lyricsScreenSize === 'medium' 
    ? `min-h-[${mediumBtnSize}px] p-1.5 text-[10px]`
    : `min-h-[${largeBtnSize}px] p-2 text-xs`;
  
  const getLyricsBtnClass = (isSquare = false) => cn(lyricsBtnSize, isSquare ? 'aspect-square' : '');
  const lyricsIconSize = lyricsScreenSize === 'small' ? 12 : lyricsScreenSize === 'medium' ? 14 : 16;

  // For now, just display raw lyrics with basic word highlighting placeholder
  const lines = lyrics.split('\n');

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Builder Toolbar */}
      <div ref={lyricsRef} className="h-12 border-b border-zinc-800 bg-zinc-900 flex items-center px-4 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('fixed')}
            className={cn(
              getLyricsBtnClass(),
              "px-3 rounded transition-colors",
              viewMode === 'fixed' ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {lyricsLabel('Fixed Text', 'Fixed')}
          </button>
          <button
            onClick={() => setViewMode('scaled')}
            className={cn(
              getLyricsBtnClass(),
              "px-3 rounded transition-colors",
              viewMode === 'scaled' ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {lyricsLabel('Scaled Time', 'Scaled')}
          </button>
        </div>

        <div className="h-6 w-px bg-zinc-700" />

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTags(!showTags)}
            className={cn(
              getLyricsBtnClass(true),
              "rounded transition-colors",
              showTags ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            )}
            title="Toggle voice tags visibility"
          >
            {showTags ? <Eye size={lyricsIconSize} /> : <EyeOff size={lyricsIconSize} />}
            {!lyricsAbbreviated && <span className="ml-1.5 text-xs">{lyricsLabel('Tags', 'Tags')}</span>}
          </button>
        </div>
        
        <div className="flex-1" />

        <button
          className={cn(getLyricsBtnClass(), "px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-colors")}
          onClick={() => alert('Publish snapshot (not yet implemented)')}
        >
          {lyricsLabel('Publish Snapshot', 'Publish')}
        </button>

        <div className="flex-1" />

        <button
          className={cn("hidden lg:flex px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-colors", lyricsBtnSize)}
          onClick={() => alert('Publish snapshot (not yet implemented)')}
        >
          {lyricsLabel('Publish Snapshot', 'Publish')}
        </button>
      </div>

      {/* Main Content: Lyrics Editor + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Lyrics Canvas */}
        <div className="flex-1 overflow-auto p-6">
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Paste or type lyrics here...
Use [S], [A], [T], [B], [U], [H] tags to mark voice parts."
            className="w-full h-full min-h-[300px] bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-zinc-100 font-mono text-sm resize-none focus:outline-none focus:border-zinc-600"
          />
          
          {/* Preview of parsed lines */}
          {lyrics && (
            <div className="mt-6 space-y-2">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Preview</h3>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                {lines.map((line, i) => (
                  <div key={i} className="font-serif text-lg leading-relaxed">
                    {line || '\u00A0'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Palette & Info */}
        <div className="w-64 border-l border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-4">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Voice Palette</h3>
            <div className="grid grid-cols-3 gap-2">
              {VOICE_PALETTE.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => setSelectedColor(voice.id)}
                  className={cn(
                    "h-10 rounded flex flex-col items-center justify-center transition-all",
                    selectedColor === voice.id ? "ring-2 ring-white scale-105" : "hover:scale-105"
                  )}
                  style={{ backgroundColor: voice.color }}
                >
                  <span className="text-xs font-bold" style={{ color: getContrastText(voice.color) }}>
                    {voice.label}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Click a color, then drag across words to paint (coming soon).
            </p>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Track Mapping</h3>
            <div className="space-y-1 text-xs">
              {tracks.filter(t => t.id !== 'metronome').map((track, idx) => (
                <div key={track.id} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: track.color }} />
                  <span className="text-zinc-400">{track.name}</span>
                  <span className="text-zinc-600 ml-auto">
                    {idx === 1 ? 'S' : idx === 2 ? 'A' : idx === 3 ? 'T' : idx === 4 ? 'B' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-4 mt-auto">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              <strong>Next steps:</strong> Implement drag-to-paint, auto-alignment, and publishing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to determine text color (black/white) based on background luminance
function getContrastText(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}