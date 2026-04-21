import { Phrase } from '../stores/useStore';

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

export async function calculatePeaksAsync(audioBuffer: AudioBuffer, length: number = 1024): Promise<number[][]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(calculatePeaks(audioBuffer, length)), 0);
  });
}

export function isTimeInPhrase(time: number, phrase: Phrase): boolean {
  const start = phrase.startPosition;
  const duration = (phrase.endCue !== undefined && phrase.startCue !== undefined) 
    ? (phrase.endCue - phrase.startCue) 
    : phrase.duration;
  return time >= start && time < start + duration;
}

export function findPhraseAtTime(time: number, phrases: Phrase[]): string | null {
  const phrase = phrases.find(p => isTimeInPhrase(time, p));
  return phrase ? phrase.id : null;
}
