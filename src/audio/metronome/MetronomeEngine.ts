/**
 * MetronomeEngine - Encapsulates metronome generation logic
 * Extracted from useAudioEngine.ts for modularity
 */
export interface MetronomeBuffer {
  bpm: number;
  timeSignature: [number, number];
  buffer: AudioBuffer;
}

export class MetronomeEngine {
  private audioContext: AudioContext;
  private bufferCache: MetronomeBuffer | null = null;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  /**
   * Generate a click track buffer for the metronome
   * Returns cached buffer if BPM and time signature haven't changed
   */
  generateClickTrackBuffer(
    bpm: number,
    timeSignature: [number, number],
    durationInSeconds: number
  ): AudioBuffer {
    // Return cached buffer if parameters haven't changed
    if (
      this.bufferCache &&
      this.bufferCache.bpm === bpm &&
      this.bufferCache.timeSignature[0] === timeSignature[0] &&
      this.bufferCache.timeSignature[1] === timeSignature[1]
    ) {
      return this.bufferCache.buffer;
    }

    const sampleRate = this.audioContext.sampleRate;
    const beatsPerSecond = bpm / 60;
    const secondsPerBeat = 1 / beatsPerSecond;
    const beatsPerBar = timeSignature[0];
    const secondsPerBar = secondsPerBeat * beatsPerBar;

    // Round up duration to the nearest whole bar
    const totalBars = Math.max(1, Math.ceil(durationInSeconds / secondsPerBar));
    const finalDuration = totalBars * secondsPerBar;

    const buffer = this.audioContext.createBuffer(1, Math.ceil(finalDuration * sampleRate), sampleRate);
    const data = buffer.getChannelData(0);

    for (let bar = 0; bar < totalBars; bar++) {
      for (let beat = 0; beat < beatsPerBar; beat++) {
        const time = bar * secondsPerBar + beat * secondsPerBeat;
        const sampleIndex = Math.floor(time * sampleRate);

        // Generate a simple click sound (sine wave burst)
        const isFirstBeat = beat === 0;
        const freq = isFirstBeat ? 1500 : 1000;
        const clickDuration = 0.05; // 50ms
        const clickSamples = Math.floor(clickDuration * sampleRate);

        for (let i = 0; i < clickSamples; i++) {
          if (sampleIndex + i < data.length) {
            // Envelope: quick attack, exponential decay
            const envelope = Math.exp(-i / (sampleRate * 0.01));
            data[sampleIndex + i] += Math.sin(2 * Math.PI * freq * (i / sampleRate)) * envelope * 0.5;
          }
        }
      }
    }

    // Cache the buffer
    this.bufferCache = {
      bpm,
      timeSignature,
      buffer
    };

    return buffer;
  }

  /**
   * Clear the buffer cache (useful when audio context changes)
   */
  clearCache(): void {
    this.bufferCache = null;
  }

  /**
   * Update the audio context (useful when context is recreated)
   */
  setAudioContext(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.clearCache();
  }
}
