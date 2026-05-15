export function trackNameFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function decodeAudioFile(file: File, audioContext: AudioContext): Promise<AudioBuffer> {
  return file.arrayBuffer().then(buf => audioContext.decodeAudioData(buf));
}

const INSTRUMENTS_VARIANTS = ['instruments', 'instrumental', 'inst', 'instr', 'accompaniment', 'acc', 'band', 'music', 'backtrack', 'backing', 'back'];

export function autoMatchFileToTrack(
  fileName: string,
  trackNames: { id: string; name: string }[]
): string | null {
  const stem = fileName.replace(/\.[^.]+$/, '').toLowerCase();

  // 1. Exact match
  for (const t of trackNames) {
    if (t.name.toLowerCase() === stem) return t.id;
  }

  // 2. Instruments variants
  for (const t of trackNames) {
    if (INSTRUMENTS_VARIANTS.includes(stem) && INSTRUMENTS_VARIANTS.includes(t.name.toLowerCase())) {
      return t.id;
    }
  }

  // 3. Prefix match
  for (const t of trackNames) {
    const tn = t.name.toLowerCase();
    if (stem.startsWith(tn) || tn.startsWith(stem)) return t.id;
  }

  // 4. Single-letter: extract the non-repeating part of filename
  // e.g. "song_S" → "S", "verse-A" → "A"
  const parts = stem.split(/[-_\s]+/);
  for (const part of parts) {
    if (part.length === 1 && !INSTRUMENTS_VARIANTS.includes(part)) {
      for (const t of trackNames) {
        if (t.name.toLowerCase().startsWith(part)) return t.id;
      }
    }
  }

  return null; // unmatched → new track
}
