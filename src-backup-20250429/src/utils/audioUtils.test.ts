import { describe, it, expect } from 'vitest';
import { isTimeInPhrase, findPhraseAtTime } from './audioUtils';
import { Phrase } from '../store/useStore';

describe('audioUtils', () => {
  const mockPhrase: Phrase = {
    id: '1',
    url: '',
    startPosition: 10,
    duration: 5,
    createdAt: Date.now(),
  };

  describe('isTimeInPhrase', () => {
    it('should return true if time is within phrase bounds', () => {
      expect(isTimeInPhrase(12, mockPhrase)).toBe(true);
    });

    it('should return false if time is before phrase', () => {
      expect(isTimeInPhrase(9, mockPhrase)).toBe(false);
    });

    it('should return false if time is after phrase', () => {
      expect(isTimeInPhrase(16, mockPhrase)).toBe(false);
    });

    it('should handle startCue and endCue correctly', () => {
      const trimmedPhrase: Phrase = {
        ...mockPhrase,
        startCue: 1,
        endCue: 3, // 2 seconds long on timeline
      };
      // startPosition is 10, so it should be from 10 to 12
      expect(isTimeInPhrase(11, trimmedPhrase)).toBe(true);
      expect(isTimeInPhrase(12.5, trimmedPhrase)).toBe(false);
    });
  });

  describe('findPhraseAtTime', () => {
    it('should return the correct phrase id', () => {
      const phrases: Phrase[] = [
        { ...mockPhrase, id: '1', startPosition: 0, duration: 5 },
        { ...mockPhrase, id: '2', startPosition: 10, duration: 5 },
      ];
      expect(findPhraseAtTime(2, phrases)).toBe('1');
      expect(findPhraseAtTime(12, phrases)).toBe('2');
      expect(findPhraseAtTime(7, phrases)).toBe(null);
    });
  });
});
