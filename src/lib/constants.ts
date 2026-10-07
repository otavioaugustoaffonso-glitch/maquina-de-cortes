import type { AspectRatio, VideoStatus } from "./types";

export const APP_NAME = "Máquina de Cortes";

/** Formatos aceitos no upload. */
export const ACCEPTED_VIDEO_TYPES: Record<string, string[]> = {
  "video/mp4": [".mp4", ".m4v"],
  "video/quicktime": [".mov"],
  "video/webm": [".webm"],
  "video/x-matroska": [".mkv"],
};

export const ACCEPTED_EXTENSIONS = Object.values(ACCEPTED_VIDEO_TYPES).flat();

/** Normaliza o MIME (navegadores às vezes enviam vazio para .mkv). */
export function resolveVideoMime(filename: string, mime?: string | null): string | null {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  for (const [type, exts] of Object.entries(ACCEPTED_VIDEO_TYPES)) {
    if (exts.includes(ext)) {
      if (!mime || mime === type || mime === "application/octet-stream" || mime === "video/matroska") return type;
      // extensão conhecida mas MIME conflitante (ex.: renomeado) -> confiamos na extensão,
      // o worker valida o conteúdo real com ffprobe.
      return type;
    }
  }
  return null;
}

/** Limite padrão de upload (sobrescrito por MAX_UPLOAD_BYTES no servidor). */
export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const DEFAULT_MAX_VIDEO_SECONDS = 4 * 60 * 60; // 4 h

/** Supabase exige chunks de exatamente 6 MB no upload resumable (TUS). */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export const BUCKETS = { videos: "videos", clips: "clips", exports: "exports" } as const;

/** Duração dos cortes (segundos). */
export const CLIP_MIN_SECONDS = 10;
export const CLIP_MAX_SECONDS = 180;
/** Tolerância: não cortar fala importante só para caber no limite. */
export const CLIP_HARD_MAX_SECONDS = 200;

export const OUTPUT_SIZES: Record<AspectRatio, { width: number; height: number; label: string }> = {
  "9:16": { width: 1080, height: 1920, label: "Vertical 9:16 (Reels, TikTok, Shorts)" },
  "4:5": { width: 1080, height: 1350, label: "Retrato 4:5 (Feed Instagram)" },
  "1:1": { width: 1080, height: 1080, label: "Quadrado 1:1" },
  "16:9": { width: 1920, height: 1080, label: "Horizontal 16:9 (YouTube)" },
};

/** Etapas exibidas ao usuário, na ordem. */
export const PROCESSING_STEPS: { status: VideoStatus; label: string }[] = [
  { status: "uploading", label: "Enviando vídeo..." },
  { status: "extracting_audio", label: "Extraindo áudio..." },
  { status: "transcribing", label: "Transcrevendo..." },
  { status: "analyzing", label: "Analisando conteúdo..." },
  { status: "finding_moments", label: "Encontrando melhores momentos..." },
  { status: "generating_clips", label: "Gerando cortes..." },
  { status: "adding_captions", label: "Adicionando legendas..." },
  { status: "finalizing", label: "Finalizando..." },
  { status: "completed", label: "Concluído." },
];

export const STATUS_LABELS: Record<VideoStatus, string> = {
  uploading: "Enviando vídeo...",
  queued: "Na fila de processamento...",
  extracting_audio: "Extraindo áudio...",
  transcribing: "Transcrevendo...",
  analyzing: "Analisando conteúdo...",
  finding_moments: "Encontrando melhores momentos...",
  generating_clips: "Gerando cortes...",
  adding_captions: "Adicionando legendas...",
  finalizing: "Finalizando...",
  completed: "Concluído.",
  failed: "Falhou",
};

export function stepIndex(status: VideoStatus): number {
  if (status === "queued") return 1;
  const i = PROCESSING_STEPS.findIndex((s) => s.status === status);
  return i < 0 ? 0 : i;
}

export const CLIP_STATUS_LABELS = {
  suggested: "Sugerido",
  queued: "Na fila",
  rendering: "Renderizando",
  ready: "Pendente",
  approved: "Aprovado",
  failed: "Falhou",
} as const;
