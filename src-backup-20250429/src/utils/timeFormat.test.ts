import { describe, it, expect } from 'vitest';
import { formatTime } from './timeFormat';

describe('formatTime', () => {
  it('formats zero correctly', () => {
    expect(formatTime(0)).toBe('00:00.00');
  });

  it('formats positive seconds correctly', () => {
    expect(formatTime(1.5)).toBe('00:01.50');
    expect(formatTime(65.25)).toBe('01:05.25');
    expect(formatTime(3600)).toBe('60:00.00');
  });

  it('formats negative seconds correctly', () => {
    expect(formatTime(-1.5)).toBe('-00:01.50');
    expect(formatTime(-65.25)).toBe('-01:05.25');
  });

  it('pads milliseconds correctly', () => {
    expect(formatTime(1.05)).toBe('00:01.05');
    expect(formatTime(1.99)).toBe('00:01.99');
  });
});
