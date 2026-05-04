import { describe, it, expect, vi } from 'vitest';
import { generateClickTrackBuffer } from '../hooks/useAudioEngine';

describe('generateClickTrackBuffer', () => {
  it('generates a buffer with correct duration and sample rate', () => {
    const mockChannelData = new Float32Array(44100 * 60); // 60 seconds
    const mockBuffer = {
      getChannelData: vi.fn().mockReturnValue(mockChannelData),
    };
    const mockAudioContext = {
      sampleRate: 44100,
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
    } as unknown as AudioContext;

    // Requesting 60 seconds
    const buffer = generateClickTrackBuffer(mockAudioContext, 120, [4, 4], 60);

    expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 44100 * 60, 44100);
    expect(buffer).toBe(mockBuffer);
    expect(mockBuffer.getChannelData).toHaveBeenCalledWith(0);
  });

  it('generates a buffer with exact requested duration', () => {
    const mockChannelData = new Float32Array(44100 * 120); // 120 seconds
    const mockBuffer = {
      getChannelData: vi.fn().mockReturnValue(mockChannelData),
    };
    const mockAudioContext = {
      sampleRate: 44100,
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
    } as unknown as AudioContext;

    // Requesting 120 seconds
    const buffer = generateClickTrackBuffer(mockAudioContext, 120, [4, 4], 120);

    expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 44100 * 120, 44100);
    expect(buffer).toBe(mockBuffer);
    expect(mockBuffer.getChannelData).toHaveBeenCalledWith(0);
  });
});
