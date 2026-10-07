import type { TimeRange } from "@/lib/clips/timing";
import { OUTPUT_SIZES } from "@/lib/constants";
import type { ClipFormat, Framing } from "@/lib/types";
import { env } from "../env";
import { ffmpeg } from "./ffmpeg";
import { cropXExpression } from "./framing";

export type RenderInput = {
  input: string;
  source: { width: number; height: number; fps: number };
  /** Início do corte no original (s). */
  clipStart: number;
  /** Trechos a manter, em tempo do ORIGINAL (já sem pausas longas). */
  segments: TimeRange[];
  format: ClipFormat;
  framing: Framing;
  assPath: string | null;
  output: string;
  onProgress?: (f: number) => void;
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Escapa um caminho para uso dentro de uma opção de filtro do FFmpeg. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Monta o filter_complex de um corte:
 *   trim/atrim de cada trecho falado -> concat (remove silêncios)
 *   -> enquadramento (crop com tracking de rosto OU fundo desfocado)
 *   -> escala para 1080x1920 (ou outro formato) -> legendas ASS
 *   -> áudio normalizado (loudnorm) para redes sociais
 */
export function buildFilterGraph(opts: Omit<RenderInput, "input" | "output" | "onProgress">): { graph: string; duration: number } {
  const { source, clipStart, segments, format, framing, assPath } = opts;
  const { width: W, height: H } = OUTPUT_SIZES[format.aspect];
  const n = segments.length;
  const parts: string[] = [];

  parts.push(`[0:v]split=${n}${segments.map((_, i) => `[vs${i}]`).join("")}`);
  parts.push(`[0:a]asplit=${n}${segments.map((_, i) => `[as${i}]`).join("")}`);
  let duration = 0;
  segments.forEach((sg, i) => {
    const a = Math.max(0, sg.s - clipStart).toFixed(3);
    const b = Math.max(0, sg.e - clipStart).toFixed(3);
    const len = sg.e - sg.s;
    duration += len;
    const fadeOut = Math.max(0, len - 0.02).toFixed(3);
    parts.push(`[vs${i}]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
    // micro fades evitam "clicks" nas emendas
    parts.push(`[as${i}]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${fadeOut}:d=0.02[a${i}]`);
  });
  parts.push(`${segments.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);

  const targetAR = W / H;
  const srcAR = source.width / source.height;
  let videoChain: string;
  if (format.layout === "fit" || Math.abs(srcAR - targetAR) < 0.01) {
    if (Math.abs(srcAR - targetAR) < 0.01) {
      videoChain = `[vc]scale=${W}:${H}:flags=lanczos,setsar=1[vf]`;
    } else {
      // Vídeo inteiro centralizado sobre uma versão desfocada dele mesmo
      const bw = even(W / 4), bh = even(H / 4);
      parts.push(`[vc]split=2[bgsrc][fgsrc]`);
      parts.push(`[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=12:2,eq=brightness=-0.06,scale=${W}:${H}[bg]`);
      parts.push(`[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`);
      videoChain = `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vf]`;
    }
  } else if (srcAR > targetAR) {
    // Origem mais larga (ex.: 16:9 -> 9:16): recorte horizontal seguindo o rosto
    const cropW = even(source.height * targetAR);
    const x = cropXExpression(framing, source.width, cropW);
    videoChain = `[vc]crop=w=${cropW}:h=${even(source.height)}:x='${x}':y=0,scale=${W}:${H}:flags=lanczos,setsar=1[vf]`;
  } else {
    // Origem mais alta: recorte vertical levemente acima do centro (rostos ficam no terço superior)
    const cropH = even(source.width / targetAR);
    const y = Math.round(Math.max(0, Math.min(source.height - cropH, source.height * 0.4 - cropH / 2)));
    videoChain = `[vc]crop=w=${even(source.width)}:h=${cropH}:x=0:y=${y},scale=${W}:${H}:flags=lanczos,setsar=1[vf]`;
  }
  parts.push(videoChain);

  if (assPath) {
    parts.push(`[vf]ass=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(env.fontsDir)}'[vout]`);
  } else {
    parts.push(`[vf]null[vout]`);
  }
  parts.push(`[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);

  return { graph: parts.join(";"), duration };
}

/** Renderiza o corte final: MP4 H.264 + AAC, 1080x1920, compatível com Reels/TikTok/Shorts. */
export async function renderClip(opts: RenderInput): Promise<{ duration: number }> {
  const { graph, duration } = buildFilterGraph(opts);
  const last = opts.segments[opts.segments.length - 1];
  const fpsMax = opts.source.fps > 0 && opts.source.fps <= 60 ? Math.round(opts.source.fps) || 30 : 30;
  await ffmpeg(
    [
      "-ss", opts.clipStart.toFixed(3),
      "-t", (last.e - opts.clipStart + 0.5).toFixed(3),
      "-i", opts.input,
      "-filter_complex", graph,
      "-map", "[vout]", "-map", "[aout]",
      "-fpsmax", String(fpsMax),
      "-c:v", "libx264", "-preset", env.x264Preset, "-crf", String(env.x264Crf),
      "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      "-t", duration.toFixed(3),
      opts.output,
    ],
    { onProgress: opts.onProgress, expectedDuration: duration },
  );
  return { duration };
}

/** Thumbnail/capa: quadro do início do corte (com título na tela), JPEG. */
export async function makeThumbnail(video: string, output: string, at = 0.8) {
  await ffmpeg(["-ss", String(at), "-i", video, "-frames:v", "1", "-q:v", "3", output]);
}
