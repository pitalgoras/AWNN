import { describe, it, expect } from 'vitest';
import { ClickRenderer } from '../audio/metronome/ClickRenderer';

describe('ClickRenderer', () => {
  it('renders a Float32Array of the correct length', () => {
    const samples = ClickRenderer.render(1000, 0.05, 44100);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBe(2205); // 0.05s * 44100
  });

  it('renders a downbeat at 1500 Hz', () => {
    const samples = ClickRenderer.render(1500, 0.05, 44100);
    expect(samples.length).toBe(2205);
    expect(samples[Math.floor(2205 / 4)]).not.toBe(0);
  });

  it('renders an offbeat at 1000 Hz', () => {
    const samples = ClickRenderer.render(1000, 0.05, 44100);
    expect(samples.length).toBe(2205);
    expect(samples[Math.floor(2205 / 4)]).not.toBe(0);
  });

  it('envelope decays to near-zero by the end', () => {
    const samples = ClickRenderer.render(1000, 0.05, 44100);
    const lastSamples = samples.slice(samples.length - 100);
    const maxEnd = Math.max(...lastSamples.map(Math.abs));
    expect(maxEnd).toBeLessThan(0.01);
  });
});
