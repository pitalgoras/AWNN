import { TAG_COLOR_MAP } from './utils';
import { normalizeVoicingTag } from './lyricsFormat';
import type { VoiceTag } from './utils';

export type TagPreviewMode = 'hidden' | 'chip' | 'full';

export interface ParsedElement {
  type: 'time-tag' | 'voice-tag' | 'section-tag' | 'word' | 'space';
  text: string;
  startChar: number;
  endChar: number;
  colorId?: string;
  time?: number;
}

export interface ParsedLine {
  id: number;
  time: number | null;
  elements: ParsedElement[];
  startIndex: number;
  endIndex: number;
}

export function buildTagColorMap(customTags: VoiceTag[]): Record<string, string> {
  const map: Record<string, string> = { ...TAG_COLOR_MAP };
  for (const ct of customTags) {
    map[ct.id] = ct.color;
  }
  return map;
}

export function isVoicingTag(tagText: string, tagColorMap: Record<string, string>): boolean {
  return tagColorMap[tagText] !== undefined;
}

const TOKENIZE_RE = /(\[T:\d+(\.\d+)?\])|(\[(ALL|S|A|T|B|Acc|S[+&]A|T[+&]B)\])|(\[[A-Za-z][A-Za-z0-9\s\-+&]*?\])|(\n)|([^\s\[\]\n]+)|([ \t]+)/g;

export function parseLyrics(text: string, tagColorMap: Record<string, string>): ParsedLine[] {
  const list: ParsedLine[] = [];
  let currentLine: ParsedLine = { id: 0, time: null, elements: [], startIndex: 0, endIndex: 0 };
  let currentVoiceColor = 'transparent';
  let charIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKENIZE_RE.exec(text)) !== null) {
    const matchText = match[0];
    const startChar = match.index;
    const endChar = match.index + matchText.length;

    if (match[1]) {
      const timeMatch = match[1].match(/\[T:(\d+(\.\d+)?)\]/);
      if (timeMatch) currentLine.time = parseFloat(timeMatch[1]);
      currentLine.elements.push({ type: 'time-tag', text: matchText, startChar, endChar, time: currentLine.time ?? undefined });
    } else if (match[3]) {
      const vId = tagColorMap[match[0]];
      if (vId) currentVoiceColor = vId;
      currentLine.elements.push({ type: 'voice-tag', text: matchText, startChar, endChar, colorId: currentVoiceColor });
    } else if (match[5]) {
      const normalizedTag = normalizeVoicingTag(matchText);
      const vId = tagColorMap[normalizedTag];
      if (vId) {
        currentVoiceColor = vId;
        currentLine.elements.push({ type: 'voice-tag', text: normalizedTag, startChar, endChar, colorId: currentVoiceColor });
      } else {
        currentLine.elements.push({ type: 'section-tag', text: matchText, startChar, endChar });
      }
    } else if (match[6]) {
      currentLine.endIndex = endChar;
      list.push(currentLine);
      currentLine = { id: list.length, time: null, elements: [], startIndex: endChar, endIndex: 0 };
    } else if (match[7]) {
      currentLine.elements.push({ type: 'word', text: matchText, startChar, endChar, colorId: currentVoiceColor });
    } else if (match[8]) {
      currentLine.elements.push({ type: 'space', text: matchText, startChar, endChar, colorId: currentVoiceColor });
    }
    charIndex = endChar;
  }

  currentLine.endIndex = charIndex;
  list.push(currentLine);

  return list;
}

export function findPrevTag(raw: string, position: number): { tag: string; index: number } | null {
  const before = raw.slice(0, position);
  const re = /\[[^\]]+\]/g;
  let m: RegExpExecArray | null;
  let last: { tag: string; index: number } | null = null;
  while ((m = re.exec(before)) !== null) {
    last = { tag: m[0], index: m.index };
  }
  return last;
}

export function removeTagsInRange(raw: string, start: number, end: number, tagColorMap: Record<string, string>): string {
  const before = raw.slice(0, start);
  const middle = raw.slice(start, end);
  const after = raw.slice(end);
  const cleaned = middle.replace(/\[[^\]]+\]/g, (m) => {
    return tagColorMap[m] !== undefined ? '' : m;
  });
  return before + cleaned + after;
}

export function applyTagToWord(raw: string, startChar: number, endChar: number, targetTag: string, tagColorMap: Record<string, string>): string {
  const textBefore = raw.slice(0, startChar);
  const last = findPrevTag(raw, startChar);
  const V = last ? last.tag : null;
  const VIndex = last ? last.index : -1;

  let isRightBefore = false;
  if (V) {
    const afterV = raw.slice(VIndex + V.length, startChar);
    const cleaned = afterV.replace(/\[T:\d+(\.\d+)?\]/g, '');
    const hasText = /\S/.test(cleaned);
    const hasVoicing = afterV.match(/\[[^\]]+\]/g)?.some(t => isVoicingTag(t, tagColorMap)) ?? false;
    isRightBefore = !hasText && !hasVoicing;
  }

  const removeForwardDuplicates = (text: string, fromIndex: number): string => {
    const voicingTagPattern = /\[[^\]]+\]/g;
    let output = text.slice(0, fromIndex);
    let rest = text.slice(fromIndex);
    let m: RegExpExecArray | null;
    voicingTagPattern.lastIndex = 0;
    while ((m = voicingTagPattern.exec(rest)) !== null) {
      if (!isVoicingTag(m[0], tagColorMap)) continue;
      if (m[0] === targetTag) {
        output += rest.slice(0, m.index);
        rest = rest.slice(m.index + m[0].length);
        voicingTagPattern.lastIndex = 0;
        continue;
      } else {
        break;
      }
    }
    output += rest;
    return output;
  };

  let newText = raw;
  if (V && V === targetTag) {
    newText = removeForwardDuplicates(raw, endChar);
  } else if (V && V !== targetTag) {
    if (isRightBefore) {
      newText = raw.slice(0, VIndex) + targetTag + raw.slice(VIndex + V.length);
      newText = removeForwardDuplicates(newText, endChar);
    } else {
      const toInsert = targetTag + ' ';
      newText = raw.slice(0, startChar) + toInsert + raw.slice(startChar);
      newText = removeForwardDuplicates(newText, endChar + toInsert.length);
    }
  } else {
    const toInsert = targetTag + ' ';
    newText = raw.slice(0, startChar) + toInsert + raw.slice(startChar);
    newText = removeForwardDuplicates(newText, endChar + toInsert.length);
  }

  return newText;
}

export function applyTagToSelection(raw: string, selStart: number, selEnd: number, targetTag: string, tagColorMap: Record<string, string>): string {
  const endTagMatch = findPrevTag(raw, selEnd);
  const endTag = endTagMatch ? endTagMatch.tag : null;
  let cleaned = removeTagsInRange(raw, selStart, selEnd, tagColorMap);
  const offset1 = 0;
  let afterFront = applyTagToWord(cleaned, selStart, selStart, targetTag, tagColorMap);
  if (endTag) {
    const insertLen = afterFront.length - cleaned.length;
    const adjEnd = selEnd + insertLen;
    afterFront = applyTagToWord(afterFront, adjEnd, adjEnd, endTag, tagColorMap);
  }
  return afterFront;
}

export function cleanupLyrics(raw: string, tagColorMap: Record<string, string>): string {
  let cleaned = raw;

  cleaned = cleaned.split('\n').map(line => {
    const tTags = line.match(/\[T:\d+(\.\d+)?\]/g);
    if (tTags && tTags.length > 1) {
      let first = true;
      return line.replace(/\[T:\d+(\.\d+)?\]/g, (match) => {
        if (first) { first = false; return match; }
        return '';
      });
    }
    return line;
  }).join('\n');

  cleaned = cleaned.replace(/(\[[^\]]+\])\s*\[ALL\]/g, (match, tag) => {
    if (tag !== '[ALL]' && isVoicingTag(tag, tagColorMap)) return '[ALL]';
    return match;
  });
  cleaned = cleaned.replace(/\[ALL\]\s*(\[[^\]]+\])/g, (match, tag) => {
    if (tag !== '[ALL]' && isVoicingTag(tag, tagColorMap)) return '[ALL]';
    return match;
  });

  cleaned = cleaned.split('\n').map(line => {
    let lastTag: string | null = null;
    return line.replace(/\[[^\]]+\]/g, (match) => {
      if (!isVoicingTag(match, tagColorMap)) return match;
      if (match === lastTag) return '';
      lastTag = match;
      return match;
    });
  }).join('\n');

  cleaned = cleaned.replace(/(\[[^\]]+\]\s*)+\[[^\]]+\]/g, (match) => {
    const tags = match.match(/\[.*?\]/g) || [];
    const voicingTags = tags.filter(t => isVoicingTag(t, tagColorMap));
    if (voicingTags.length <= 1) return match;
    return voicingTags[voicingTags.length - 1] + ' ';
  });

  return cleaned;
}

export function postProcessSpaceColors(parsedLines: ParsedLine[]): void {
  for (const line of parsedLines) {
    const els = line.elements;
    let firstColorIdx = -1;
    let lastColorIdx = -1;
    for (let i = 0; i < els.length; i++) {
      if (els[i].colorId && els[i].colorId !== 'transparent') {
        if (firstColorIdx === -1) firstColorIdx = i;
        lastColorIdx = i;
      }
    }
    if (firstColorIdx === -1) continue;

    for (let i = 0; i < els.length; i++) {
      if (els[i].type !== 'space') continue;
      if (i < firstColorIdx || i > lastColorIdx) {
        delete els[i].colorId;
        continue;
      }
      let prevColor = 'transparent';
      for (let j = i - 1; j >= 0; j--) {
        if (els[j].colorId && els[j].colorId !== 'transparent') {
          prevColor = els[j].colorId;
          break;
        }
      }
      let nextColor = 'transparent';
      for (let j = i + 1; j < els.length; j++) {
        if (els[j].colorId && els[j].colorId !== 'transparent') {
          nextColor = els[j].colorId;
          break;
        }
      }
      if (prevColor !== nextColor) {
        delete els[i].colorId;
      }
    }
  }
}
