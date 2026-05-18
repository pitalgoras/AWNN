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

export function getTrackInitials(name: string, existingInitials: string[]): string | null {
  for (const len of [3, 2, 1]) {
    const candidate = name.substring(0, len);
    if (!existingInitials.includes(candidate)) return candidate;
  }
  return null;
}

function blendColors(hex1: string, hex2: string): string {
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

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

export interface VoiceTag {
  id: string;
  label: string;
  color: string;
  trackIds: string[];
  isComposite: boolean;
}

export function generateVoiceTags(tracks: { id: string; name: string; color: string; isInstrument?: boolean }[]): VoiceTag[] {
  const filtered = tracks.filter(t => t.id !== 'metronome');
  const voices = filtered.filter(t => !t.isInstrument);
  const tags: VoiceTag[] = [];

  // Individual tracks (all tracks including instrument)
  for (const t of filtered) {
    tags.push({
      id: t.id,
      label: getShortLabel(t.name, 3),
      color: t.color,
      trackIds: [t.id],
      isComposite: false,
    });
  }

  // 2-way combos (voice tracks only)
  const pairs = getCombinations(voices, 2);
  for (const pair of pairs) {
    const [a, b] = pair;
    tags.push({
      id: `combo-${a.id}-${b.id}`,
      label: `${getShortLabel(a.name, 1)}&${getShortLabel(b.name, 1)}`,
      color: blendColors(a.color, b.color),
      trackIds: [a.id, b.id],
      isComposite: true,
    });
  }

  // All (standalone — not a composite of tracks)
  tags.push({
    id: 'all',
    label: 'All',
    color: '#a1a1aa',
    trackIds: [],
    isComposite: false,
  });

  // Har (standalone — not a composite of tracks)
  tags.push({
    id: 'har',
    label: 'Har',
    color: '#F97316',
    trackIds: [],
    isComposite: false,
  });

  return tags;
}

// 3-way combos (generated lazily for [+] expander) — voice tracks only
export function generate3WayTags(tracks: { id: string; name: string; color: string; isInstrument?: boolean }[]): VoiceTag[] {
  const voices = tracks.filter(t => t.id !== 'metronome' && !t.isInstrument);
  if (voices.length < 3) return [];

  const triples = getCombinations(voices, 3);
  return triples.map(triple => ({
    id: `combo-${triple.map(t => t.id).join('-')}`,
    label: triple.map(t => getShortLabel(t.name, 1)).join('+'),
    color: triple.reduce((acc, t) => blendColors(acc, t.color), triple[0].color),
    trackIds: triple.map(t => t.id),
    isComposite: true,
  }));
}
