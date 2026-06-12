import JSZip from 'jszip';
import { audioBufferToWav } from '../processing/audioBufferToWav';

export async function exportProject(state: any): Promise<boolean> {
  try {
    const zip = new JSZip();

    const meta: any = {
      version: 3,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      globalLatencyMs: state.globalLatencyMs,
      lyricsText: state.lyricsText,
      lyricsSegments: state.lyricsSegments,
      cues: state.cues,
      tracks: [],
    };

    for (const track of state.tracks) {
      const trackMeta: any = {
        id: track.id,
        name: track.name,
        color: track.color,
        isMuted: track.isMuted,
        isSolo: track.isSolo,
        volume: track.volume,
        pan: track.pan,
        offset: track.offset,
        anchoredFrame: track.anchoredFrame,
        envelope: track.envelope,
        phrases: [],
      };

      for (let i = 0; i < track.phrases.length; i++) {
        const phrase = track.phrases[i];
        let wavBlob: Blob;
        if (phrase.blob) {
          // Imported file: convert to WAV for consistent format in zip
          const ctx = new AudioContext();
          const ab = await phrase.blob.arrayBuffer();
          const buf = await ctx.decodeAudioData(ab);
          wavBlob = audioBufferToWav(buf);
          ctx.close();
        } else if (phrase.audioBuffer) {
          wavBlob = audioBufferToWav(phrase.audioBuffer);
        } else continue;

        const filename = `audio/${track.id}_${i}.wav`;
        zip.file(filename, wavBlob);

        trackMeta.phrases.push({
          id: phrase.id,
          startPosition: phrase.startPosition,
          originalStartPosition: phrase.originalStartPosition,
          headLength: phrase.headLength,
          anchoredFrame: phrase.anchoredFrame,
          originalAnchoredFrame: phrase.originalAnchoredFrame,
          duration: phrase.duration,
          startCue: phrase.startCue,
          endCue: phrase.endCue,
          createdAt: phrase.createdAt,
          name: phrase.name,
        });
      }

      meta.tracks.push(trackMeta);
    }

    zip.file('metadata.json', JSON.stringify(meta));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `AWNN_Project_${new Date().toISOString().slice(0, 10)}.awnn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  } catch (err) {
    console.error('Export Failed:', err);
    return false;
  }
}

export async function importProject(file: File): Promise<any> {
  const zip = await JSZip.loadAsync(file);
  const meta = JSON.parse(await zip.file('metadata.json').async('string'));

  const tracks = await Promise.all(meta.tracks.map(async (t: any) => {
    const phrases = await Promise.all(t.phrases.map(async (p: any, i: number) => {
      try {
        const wavBlob = await zip.file(`audio/${t.id}_${i}.wav`).async('blob');
        return {
          ...p,
          blob: wavBlob,
          url: URL.createObjectURL(wavBlob),
        };
      } catch {
        return { ...p, blob: undefined, url: '' };
      }
    }));
    return { ...t, phrases };
  }));

  return {
    tracks,
    cues: meta.cues || [],
    bpm: meta.bpm || 120,
    timeSignature: meta.timeSignature || [4, 4],
    globalLatencyMs: meta.globalLatencyMs || 0,
    lyricsText: meta.lyricsText || '',
    lyricsSegments: meta.lyricsSegments || [],
  };
}
