/** Palavra transcrita com timestamps (segundos). Formato compacto para jsonb. */
export type Word = { w: string; s: number; e: number };

/** Segmento (frase) transcrito. */
export type Segment = { s: number; e: number; t: string };

export type VideoStatus =
  | "uploading"
  | "queued"
  | "extracting_audio"
  | "transcribing"
  | "analyzing"
  | "finding_moments"
  | "generating_clips"
  | "adding_captions"
  | "finalizing"
  | "completed"
  | "failed";

export type ClipStatus = "suggested" | "queued" | "rendering" | "ready" | "approved" | "failed";

export type JobType = "process_video" | "render_clip" | "export_zip";

export type AspectRatio = "9:16" | "1:1" | "4:5" | "16:9";
export type Layout = "fill" | "fit";
export type ClipFormat = { aspect: AspectRatio; layout: Layout };

export type CaptionPresetId = "minimal" | "highlight" | "viral" | "podcast" | "clean";
export type CaptionFont = "Inter" | "Montserrat" | "Poppins" | "Anton" | "Bebas Neue";
export type CaptionPosition = "top" | "middle" | "bottom";
export type CaptionBackground = "none" | "shadow" | "box";
export type CaptionAnimation = "none" | "pop" | "fade";
export type CaptionHighlightMode = "word" | "keywords" | "none";

export type CaptionStyle = {
  enabled: boolean;
  preset: CaptionPresetId;
  font: CaptionFont;
  /** Tamanho em px considerando largura de saída de 1080px. */
  fontSize: number;
  bold: boolean;
  position: CaptionPosition;
  /** Cor do texto (#RRGGBB). */
  color: string;
  /** Cor de destaque (palavra falada / palavras-chave). */
  highlightColor: string;
  background: CaptionBackground;
  backgroundColor: string;
  /** 0..1 */
  backgroundOpacity: number;
  animation: CaptionAnimation;
  highlightMode: CaptionHighlightMode;
  /** Também destaca as palavras-chave do corte. */
  highlightKeywords: boolean;
  uppercase: boolean;
  wordsPerLine: number;
};

/** Notas 0..10 atribuídas pela IA. */
export type AiScores = {
  hook: number;
  clarity: number;
  value: number;
  emotion: number;
  curiosity: number;
  standalone: number;
};

export type SpeechMetrics = {
  wordCount: number;
  wordsPerSecond: number;
  /** Fração do tempo em pausas > 0.4s. */
  pauseRatio: number;
  longestPause: number;
  fillerRatio: number;
  startsClean: boolean;
  endsClean: boolean;
};

export type ScoreBreakdown = AiScores & {
  flow: number; // 0..10, calculado localmente (pausas, ritmo, vícios de linguagem)
  metrics: SpeechMetrics;
};

/** Corte sugerido pela IA (antes do pós-processamento). */
export type RawClipCandidate = {
  start: number;
  end: number;
  title: string;
  description: string;
  hook: string;
  reason: string;
  category: string;
  keywords: string[];
  hashtags: string[];
  social_caption: string;
  title_on_screen: string;
  scores: AiScores;
};

/** Corte final, pronto para gravar no banco. */
export type ClipCandidate = Omit<RawClipCandidate, "scores"> & {
  score: number;
  retentionPotential: string;
  breakdown: ScoreBreakdown;
  rank: number;
};

export type FramingKeyframe = { t: number; x: number };
export type Framing = { mode: "face" | "center"; keyframes: FramingKeyframe[] };
