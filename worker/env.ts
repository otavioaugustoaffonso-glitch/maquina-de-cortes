import "dotenv/config";
import os from "node:os";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] != null ? v : fallback;
};

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  workerId: process.env.WORKER_ID || `${os.hostname()}-${process.pid}`,
  concurrency: num("WORKER_CONCURRENCY", 1),
  pollIntervalMs: num("WORKER_POLL_INTERVAL_MS", 2000),
  tmpDir: path.resolve(process.env.WORKER_TMP_DIR || path.join(os.tmpdir(), "maquina-de-cortes")),
  cacheTtlHours: num("WORKER_CACHE_TTL_HOURS", 6),
  fontsDir: path.resolve(process.env.WORKER_FONTS_DIR || path.join(process.cwd(), "worker", "fonts")),
  pythonBin: process.env.PYTHON_BIN || "python3",
  ffmpegBin: process.env.FFMPEG_BIN || "ffmpeg",
  ffprobeBin: process.env.FFPROBE_BIN || "ffprobe",
  x264Preset: process.env.X264_PRESET || "medium",
  x264Crf: num("X264_CRF", 20),
  proxyEnabled: process.env.PROXY_ENABLED !== "false",
  faceTracking: process.env.FACE_TRACKING !== "false",
  maxAutoRender: num("MAX_AUTO_RENDER", 30),
  maxVideoSeconds: num("MAX_VIDEO_SECONDS", 4 * 60 * 60),
  enforceCredits: process.env.ENFORCE_CREDITS === "true",
  exportTtlDays: num("EXPORT_TTL_DAYS", 7),

  // Padrões GRATUITOS: nada pago roda sem configuração explícita (ver ALLOW_PAID_PROVIDERS)
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER || "local") as "local" | "groq" | "openai" | "mock",
  analysisProvider: (process.env.ANALYSIS_PROVIDER || "heuristic") as "heuristic" | "gemini" | "groq" | "ollama" | "openai-compatible" | "anthropic",
};
