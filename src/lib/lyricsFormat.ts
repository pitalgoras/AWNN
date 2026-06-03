const TIME_TAG_RE = /^\[T:(\d+(?:\.\d+)?)\]\s*/;
const BRACKET_TAG_RE = /^(\[[^\]]+\])\s*/;

export const EXPANDED_TAG_MAP: Record<string, string> = {
  Soprano: 'S',
  Alto: 'A',
  Tenor: 'T',
  Bass: 'B',
  Accompaniment: 'Acc',
  Harmony: 'Har',
  All: 'ALL',
};

export function normalizeVoicingTag(tag: string): string {
  const inner = tag.replace(/[[\]]/g, '');
  const canonical = EXPANDED_TAG_MAP[inner] ?? inner;
  return `[${canonical}]`;
}
