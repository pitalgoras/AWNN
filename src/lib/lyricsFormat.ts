// Round-trip converter between raw lyrics format and tabular edit format
//
// Raw format (stored in Zustand):
//   [T:1.23] [S] Hello world
//   [T:5.67] [A] How are you
//   [Chorus]
//   [S] This is the chorus
//
// Tabular format (shown in textarea):
//   1.23\t[S]\tHello world
//   5.67\t[A]\tHow are you
//   \t[Chorus]\t
//   \t[S]\tThis is the chorus
//
// Always exactly 3 tab-separated columns: time | voicing/section tag | text.
// Empty columns are empty strings → double/triple tabs maintain alignment.

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

export function rawToTabular(raw: string): string {
  const lines = raw.split('\n');
  return lines
    .map((line) => {
      let remaining = line;
      let timeCol = '';
      let tagCol = '';
      let textCol = '';

      const timeMatch = remaining.match(TIME_TAG_RE);
      if (timeMatch) {
        timeCol = timeMatch[1];
        remaining = remaining.slice(timeMatch[0].length);
      }

      const tagMatch = remaining.match(BRACKET_TAG_RE);
      if (tagMatch) {
        tagCol = tagMatch[1];
        remaining = remaining.slice(tagMatch[0].length);
      }

      textCol = remaining;
      return `${timeCol}\t${tagCol}\t${textCol}`;
    })
    .join('\n');
}

export function tabularToRaw(tabular: string): string {
  const lines = tabular.split('\n');
  return lines
    .map((line) => {
      const parts = line.split('\t');
      const timeCol = parts[0] ?? '';
      const tagCol = parts[1] ?? '';
      const textCol = parts.slice(2).join('\t');

      let raw = '';

      if (timeCol) {
        raw += `[T:${timeCol}] `;
      }

      if (tagCol) {
        raw += `${normalizeVoicingTag(tagCol)} `;
      }

      raw += textCol;
      return raw;
    })
    .join('\n');
}
