import { env } from "../env";
import { ffmpeg, run } from "./ffmpeg";

/**
 * Extrai o áudio em MP3 mono 16 kHz / 32 kbps (~14 MB por hora).
 * É o formato ideal para APIs de transcrição: pequeno e suficiente para fala.
 */
export async function extractAudio(input: string, output: string, onProgress?: (f: number) => void, duration?: number) {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", output], {
    onProgress,
    expectedDuration: duration,
  });
}

/** Detecta silêncios no áudio (usado para escolher pontos de divisão seguros). */
export async function detectSilences(input: string, noiseDb = -32, minDuration = 0.35): Promise<{ s: number; e: number }[]> {
  // silencedetect escreve no stderr em nível "info"
  const { stderr } = await run(env.ffmpegBin, [
    "-hide_banner", "-nostdin", "-i", input, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, "-f", "null", "-",
  ], { fullStderr: true });
  return parseSilences(stderr);
}

export function parseSilences(stderr: string): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const ms = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (ms) start = Math.max(0, Number(ms[1]));
    const me = line.match(/silence_end:\s*([\d.]+)/);
    if (me && start != null) {
      out.push({ s: start, e: Number(me[1]) });
      start = null;
    }
  }
  return out;
}

/**
 * Planeja a divisão do áudio em pedaços (limite de 25 MB das APIs Whisper),
 * cortando sempre no meio de um silêncio próximo ao alvo para não partir palavras.
 */
export function planChunks(duration: number, silences: { s: number; e: number }[], target = 600, window = 45): { start: number; end: number }[] {
  if (duration <= target + window) return [{ start: 0, end: duration }];
  const chunks: { start: number; end: number }[] = [];
  let start = 0;
  while (duration - start > target + window) {
    const ideal = start + target;
    const candidates = silences
      .map((sl) => (sl.s + sl.e) / 2)
      .filter((m) => m > ideal - window && m < ideal + window);
    const cut = candidates.length
      ? candidates.reduce((best, m) => (Math.abs(m - ideal) < Math.abs(best - ideal) ? m : best))
      : ideal;
    chunks.push({ start, end: cut });
    start = cut;
  }
  chunks.push({ start, end: duration });
  return chunks.map((c) => ({ start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 }));
}

export async function cutAudio(input: string, output: string, start: number, end: number) {
  await ffmpeg(["-ss", String(start), "-i", input, "-t", String(end - start), "-c", "copy", output]);
}

/** Preview leve (540p H.264) — permite pré-visualizar qualquer formato (ex.: MKV) no navegador. */
export async function makeProxy(input: string, output: string, onProgress?: (f: number) => void, duration?: number) {
  await ffmpeg(
    [
      "-i", input,
      "-vf", "scale=-2:'min(540,ih)'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-g", "60",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      "-movflags", "+faststart",
      output,
    ],
    { onProgress, expectedDuration: duration },
  );
}
