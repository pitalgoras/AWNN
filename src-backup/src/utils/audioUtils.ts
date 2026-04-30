import { Phrase } from '../store/useStore';

/**
 * Calculates peaks for a given AudioBuffer.
 * This can be used to pre-calculate peaks for WaveSurfer to avoid main-thread spikes.
 */
export function calculatePeaks(audioBuffer: AudioBuffer, length: number = 1024): number[][] {
  const peaks: number[][] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    const sampleSize = Math.floor(channelData.length / length);
    const channelPeaks: number[] = [];
    for (let i = 0; i < length; i++) {
      let max = 0;
      for (let j = 0; j < sampleSize; j++) {
        const idx = i * sampleSize + j;
        if (idx >= channelData.length) break;
        const val = Math.abs(channelData[idx]);
        if (val > max) max = val;
      }
      channelPeaks.push(max);
      channelPeaks.push(-max);
    }
    peaks.push(channelPeaks);
  }
  return peaks;
}

/**
 * Offloads peak calculation to a background task (simulated worker for now, 
 * but could be a real Web Worker in production).
 */
export async function calculatePeaksAsync(audioBuffer: AudioBuffer, length: number = 1024): Promise<number[][]> {
  // In a real app, we'd use a Web Worker here.
  // For now, we'll use a small delay to simulate async behavior and avoid blocking the main thread immediately.
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(calculatePeaks(audioBuffer, length));
    }, 0);
  });
}

/**
 * Checks if a given time (in seconds) is within the bounds of a phrase on the timeline.
 */
export function isTimeInPhrase(time: number, phrase: Phrase): boolean {
  const start = phrase.startPosition;
  const duration = (phrase.endCue !== undefined && phrase.startCue !== undefined) 
    ? (phrase.endCue - phrase.startCue) 
    : phrase.duration;
  
  return time >= start && time < start + duration;
}

/**
 * Finds the ID of the phrase that occupies a specific time on the timeline.
 */
export function findPhraseAtTime(time: number, phrases: Phrase[]): string | null {
  const phrase = phrases.find(p => isTimeInPhrase(time, p));
  return phrase ? phrase.id : null;
}
