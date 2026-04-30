export interface SongMeta {
  id: string;
  title: string;
  version: number;
  author: string;
  created_at: string;
  updated_at: string;
}

export interface LyricsLine {
  index: number;
  text: string;
  start_char: number;
  end_char: number;
}

export interface VoicingSegment {
  id: string;
  line_index: number;
  start_char: number;
  end_char: number;
  color_id: string;
  label: string;
  priority_track_id?: string;
}

export interface AlignmentBlock {
  segment_id: string;
  start_time: number;
  end_time: number;
  gap_after?: boolean;
  snap_confidence: number;
}

export interface SongSnapshot {
  meta: SongMeta;
  audio: {
    tracks: { id: string; label: string; relative_path: string; default_volume: number }[];
  };
  lyrics: {
    raw: string;
    lines: LyricsLine[];
  };
  voicing: {
    palette: Record<string, { hex: string; name: string }>;
    segments: VoicingSegment[];
  };
  alignment: {
    blocks: AlignmentBlock[];
  };
  ui_state?: {
    default_view: 'fixed' | 'scaled';
    heatmap_visible: boolean;
    focus_voice_part?: string;
  };
}

export type SongsIndex = {
  last_updated: string;
  songs: Record<string, { latest_version_path: string; title: string }>;
};
