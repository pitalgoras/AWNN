import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getContrastColor(hex: string): string {
  const color = hex.replace('#', '');
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

export function getShortLabel(name: string, maxLen: number = 3): string {
  return name.substring(0, maxLen);
}

export function getTrackShortLabel(track: { name: string; shortLabel?: string }, maxLen: number = 3): string {
  return track.shortLabel || track.name.substring(0, maxLen);
}

export function getTrackInitials(name: string, existingInitials: string[]): string | null {
  for (const len of [3, 2, 1]) {
    const candidate = name.substring(0, len);
    if (!existingInitials.includes(candidate)) return candidate;
  }
  return null;
}

export function blendColors(hex1: string, hex2: string): string {
  const toHsl = (hex: string): [number, number, number] => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s * 100, l * 100];
  };
  const fromHsl = (h: number, s: number, l: number): string => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  const [h1, s1, l1] = toHsl(hex1);
  const [h2, s2, l2] = toHsl(hex2);

  let ah1 = h1, ah2 = h2;
  if (Math.abs(h1 - h2) > 180) {
    if (h1 < h2) ah1 += 360; else ah2 += 360;
  }
  let h = (ah1 + ah2) / 2;
  if (h >= 360) h -= 360;

  return fromHsl(h, Math.max(s1, s2), (l1 + l2) / 2);
}

export interface VoiceTag {
  id: string;
  label: string;
  color: string;
  trackIds: string[];
  isComposite: boolean;
  usedInSession?: boolean;
}

// Single source of truth for built-in voice tag IDs, colors, and labels
// Tag ID is the canonical tag text (always uses + separator for combos)
export const TAG_COLOR_MAP: Record<string, string> = {
  '[ALL]': '#A0AEC0',
  '[Har]': '#F97316',
  '[Acc]': '#4a5568',
  '[S]': '#F6E05E',
  '[A]': '#F56565',
  '[T]': '#48BB78',
  '[B]': '#4299E1',
  '[S+A]': '#F6A161',
  '[S&A]': '#F6A161',
  '[T+B]': '#34DFD4',
  '[T&B]': '#34DFD4',
};

export const TAG_LABEL_MAP: Record<string, string> = {
  '[ALL]': 'All',
  '[Har]': 'Har',
  '[Acc]': 'Acc',
  '[S]': 'S',
  '[A]': 'A',
  '[T]': 'T',
  '[B]': 'B',
};

const TAG_LONG_LABEL_MAP: Record<string, string> = {
  '[ALL]': 'All',
  '[Har]': 'Harmony',
  '[Acc]': 'Accompaniment',
  '[S]': 'Soprano',
  '[A]': 'Alto',
  '[T]': 'Tenor',
  '[B]': 'Bass',
};

export function getTagColor(tagId: string): string {
  return TAG_COLOR_MAP[tagId] ?? 'transparent';
}

export function getTagLabel(tagId: string): string {
  return TAG_LABEL_MAP[tagId] ?? tagId.replace(/[[\]]/g, '');
}

export function getTagLongLabel(tagId: string): string {
  return TAG_LONG_LABEL_MAP[tagId] ?? tagId.replace(/[[\]]/g, '');
}

// Build a canonical combo tag ID (always uses + separator internally)
export function buildComboTagId(a: string, b: string): string {
  return `[${a}+${b}]`;
}

// Build a display label for a combo tag (respects current separator preference)
export function buildComboLabel(a: string, b: string, sep: string): string {
  return `${a}${sep}${b}`;
}

// Build the display color for a combo tag by blending the two source colors
export function getComboColor(trackA: { color: string }, trackB: { color: string }): string {
  return blendColors(trackA.color, trackB.color);
}

// Get the short label for a track (used for tag IDs)
export function getTrackTagLabel(track: { id: string; name: string; shortLabel?: string }): string {
  return track.shortLabel || getShortLabel(track.name, 1);
}

export function generateVoiceTags(tracks: { id: string; name: string; color: string; isInstrument?: boolean; shortLabel?: string }[]): VoiceTag[] {
  const filtered = tracks.filter(t => t.id !== 'metronome');
  const tags: VoiceTag[] = [];

  for (const t of filtered) {
    const tagId = `[${getTrackTagLabel(t)}]`;
    tags.push({
      id: tagId,
      label: getTrackShortLabel(t, 3),
      color: t.color,
      trackIds: [t.id],
      isComposite: false,
    });
  }

  tags.push({
    id: '[ALL]',
    label: 'All',
    color: '#A0AEC0',
    trackIds: [],
    isComposite: false,
  });

  tags.push({
    id: '[Har]',
    label: 'Har',
    color: '#F97316',
    trackIds: [],
    isComposite: false,
  });

  return tags;
}
