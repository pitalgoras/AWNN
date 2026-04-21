import React, { useState, useEffect } from 'react';
import { useStore } from './stores/useStore';
import { useAudioEngine } from './hooks/useAudioEngine';
import AudioEditorView from './components/AudioEditorView';
import LyricsBuilderView from './components/LyricsBuilderView';
import { FileText, Mic } from 'lucide-react';

export default function App() {
  const [mode, setMode] = useState<'editor' | 'builder'>('editor');
  const isReady = useStore(s => s.isReady);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="h-12 border-b border-zinc-800 bg-zinc-900 flex items-center px-4 justify-between">
        <h1 className="font-bold">AWNN</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('editor')}
            className={`p-2 rounded ${mode === 'editor' ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}
            title="Audio Editor"
          >
            <Mic size={18} />
          </button>
          <button
            onClick={() => setMode('builder')}
            className={`p-2 rounded ${mode === 'builder' ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}
            title="Lyrics Builder"
          >
            <FileText size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden">
        {!isReady ? (
          <div className="flex-1 flex items-center justify-center">Loading...</div>
        ) : mode === 'editor' ? (
          <AudioEditorView />
        ) : (
          <LyricsBuilderView />
        )}
      </main>
    </div>
  );
}
