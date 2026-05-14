export class ClickRenderer {
  static render(freq: number, durationSec: number, sampleRate: number, gain = 0.5): Float32Array {
    const length = Math.floor(durationSec * sampleRate);
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t / 0.01);
      samples[i] = Math.sin(2 * Math.PI * freq * t) * envelope * gain;
    }
    return samples;
  }
}
