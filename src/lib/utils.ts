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
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return '#' + [r1, g1, b1].map((_, i) =>
    Math.floor(([r1, g1, b1][i] + [r2, g2, b2][i]) / 2).toString(16).padStart(2, '0')
  ).join('');
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
