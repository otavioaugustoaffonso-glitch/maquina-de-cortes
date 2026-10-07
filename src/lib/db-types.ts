import type { CaptionStyle, ClipFormat, ClipStatus, Framing, ScoreBreakdown, VideoStatus, Word } from "./types";

export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  settings: { language?: string; captionStyle?: CaptionStyle; format?: ClipFormat };
  created_at: string;
  updated_at: string;
};

export type VideoRow = {
  id: string;
  project_id: string;
  user_id: string;
  original_filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  proxy_path: string | null;
  status: VideoStatus;
  progress: number;
  status_message: string | null;
  error: string | null;
  created_at: string;
};

export type ClipRow = {
  id: string;
  project_id: string;
  video_id: string;
  user_id: string;
  rank: number;
  status: ClipStatus;
  render_stage: string | null;
  start_time: number;
  end_time: number;
  title: string;
  description: string;
  hook: string;
  reason: string;
  category: string | null;
  retention_potential: string | null;
  keywords: string[];
  hashtags: string[];
  social_caption: string;
  score: number;
  score_breakdown: Partial<ScoreBreakdown>;
  caption_style: Partial<CaptionStyle>;
  caption_words: Word[] | null;
  format: ClipFormat;
  remove_silences: boolean;
  show_title: boolean;
  title_on_screen: string | null;
  output_path: string | null;
  thumbnail_path: string | null;
  output_size_bytes: number | null;
  output_duration_seconds: number | null;
  framing: Framing | null;
  render_error: string | null;
  rendered_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExportRow = {
  id: string;
  project_id: string;
  status: "queued" | "processing" | "ready" | "failed" | "expired";
  clip_ids: string[];
  size_bytes: number | null;
  error: string | null;
  expires_at: string | null;
  created_at: string;
};

export type DashboardStats = {
  projects: number;
  videos_processed: number;
  videos_processing: number;
  clips_total: number;
  clips_approved: number;
  clips_pending: number;
  storage_bytes: number;
  minutes_processed: number;
};
