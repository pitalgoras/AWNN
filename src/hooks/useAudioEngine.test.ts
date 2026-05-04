import { describe, it, expect, vi } from 'vitest';
import { MetronomeEngine } from '../audio/metronome/MetronomeEngine';

describe('MetronomeEngine', () => {
  it('generates a buffer with correct duration and sample rate', () => {
    const mockBuffer = {
      getChannelData: vi.fn().mockReturnValue(new Float32Array(44100 * 60)),
      duration: 60,
      sampleRate: 44100,
    };
    const mockAudioContext = {
      sampleRate: 44100,
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
    } as unknown as AudioContext;

    const engine = new MetronomeEngine(mockAudioContext);
    const buffer = engine.generateClickTrackBuffer(120, [4, 4], 60);

    expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 44100 * 60, 44100);
    expect(buffer).toBe(mockBuffer);
    expect(mockBuffer.getChannelData).toHaveBeenCalledWith(0);
  });

  it('generates a buffer with exact requested duration', () => {
    const mockBuffer = {
      getChannelData: vi.fn().mockReturnValue(new Float32Array(44100 * 120)),
      duration: 120,
      sampleRate: 44100,
    };
    const mockAudioContext = {
      sampleRate: 44100,
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
    } as unknown as AudioContext;

    const engine = new MetronomeEngine(mockAudioContext);
    const buffer = engine.generateClickTrackBuffer(120, [4, 4], 120);

    expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 44100 * 120, 44100);
    expect(buffer).toBe(mockBuffer);
    expect(mockBuffer.getChannelData).toHaveBeenCalledWith(0);
  });

  it('caches buffer and returns cached version on same parameters', () => {
    const mockBuffer = {
      getChannelData: vi.fn().mockReturnValue(new Float32Array(44100 * 60)),
      duration: 60,
      sampleRate: 44100,
    };
    const mockAudioContext = {
      sampleRate: 44100,
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
    } as unknown as AudioContext;

    const engine = new MetronomeEngine(mockAudioContext);
    const buffer1 = engine.generateClickTrackBuffer(120, [4, 4], 60);
    const buffer2 = engine.generateClickTrackBuffer(120, [4, 4], 60);

    expect(mockAudioContext.createBuffer).toHaveBeenCalledTimes(1);
    expect(buffer1).toBe(buffer2);
  });
});
