import { Track, Phrase } from '../store/useStore';

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const base64ToBlob = async (base64: string): Promise<Blob> => {
  const response = await fetch(base64);
  return response.blob();
};

export const exportProjectToJSON = async (state: any) => {
  try {
    const serializedTracks = await Promise.all(state.tracks.map(async (track: Track) => {
      const serializedPhrases = await Promise.all(track.phrases.map(async (phrase: Phrase) => {
        let base64Blob = null;
        if (phrase.blob) {
          base64Blob = await blobToBase64(phrase.blob);
        }
        return {
          ...phrase,
          blob: base64Blob, // Convert blob to base64
          audioBuffer: undefined, // Don't serialize heavy buffers
          url: undefined // Don't serialize temporary URLs
        };
      }));

      return {
        ...track,
        phrases: serializedPhrases
      };
    }));

    const projectData = {
      version: 1,
      tracks: serializedTracks,
      cues: state.cues,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      globalLatencyMs: state.globalLatencyMs,
      lyricsText: state.lyricsText,
      lyricsSegments: state.lyricsSegments,
    };

    const dataStr = JSON.stringify(projectData);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `AWNN_Project_${new Date().toISOString().slice(0, 10)}.awnn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Optional HTTP PUT (As requested for server shared folder logic)
    try {
      await fetch('/api/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: dataStr
      });
      console.log('Project saved to server (if endpoint exists).');
    } catch {
      console.log('Server save skipped. (No backend running)');
    }
    
    return true;
  } catch (err) {
    console.error("Export Failed: ", err);
    return false;
  }
};

export const importProjectFromJSON = async (file: File): Promise<any> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        const restoredTracks = await Promise.all((data.tracks as Track[]).map(async (track: Track) => {
          const restoredPhrases = await Promise.all((track.phrases as (Phrase & { blob?: string })[]).map(async (phrase) => {
            let blob: Blob | undefined;
            let url = phrase.url || '';
            if (phrase.blob) {
              blob = await base64ToBlob(phrase.blob);
              url = URL.createObjectURL(blob);
            }
            return {
              ...phrase,
              blob,
              url
            };
          }));
          return {
            ...track,
            phrases: restoredPhrases
          };
        }));

        resolve({
          ...data,
          tracks: restoredTracks
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};
