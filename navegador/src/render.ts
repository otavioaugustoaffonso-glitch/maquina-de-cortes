/**
 * Renderização dos cortes 100% no navegador: o vídeo original é desenhado num
 * canvas vertical (recorte 9:16 ou fundo desfocado), as legendas animadas são
 * desenhadas por cima e o MediaRecorder grava canvas + áudio em tempo real.
 * Pausas longas são removidas pulando entre os trechos com fala.
 */
import type { CaptionLine } from "@/lib/captions/grouping";
import { framingXAt } from "@/lib/clips/framing";
import type { TimeRange } from "@/lib/clips/timing";
import type { CaptionStyle, Framing } from "@/lib/types";

export type Aspect = "9:16" | "4:5" | "1:1";
export type LayoutMode = "fill" | "fit";
export const SIZES: Record<Aspect, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "4:5": { w: 1080, h: 1350 },
  "1:1": { w: 1080, h: 1080 },
};

export function pickMimeType(): { mime: string; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: [string, "mp4" | "webm"][] = [
    // MP4 com H.264 (formato aceito por Instagram, TikTok e YouTube)
    ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1.4D401F,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1,opus", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  W: number,
  H: number,
  layout: LayoutMode,
  cropX: number,
) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return;
  const tAR = W / H;
  const sAR = sw / sh;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (layout === "fit" && Math.abs(sAR - tAR) > 0.01) {
    // fundo: o próprio vídeo ampliado e desfocado
    const scale = Math.max(W / sw, H / sh) * 1.1;
    ctx.save();
    ctx.filter = "blur(40px) brightness(0.6)";
    ctx.drawImage(video, (W - sw * scale) / 2, (H - sh * scale) / 2, sw * scale, sh * scale);
    ctx.restore();
    const s = Math.min(W / sw, H / sh);
    ctx.drawImage(video, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
    return;
  }
  if (sAR > tAR) {
    const cw = sh * tAR;
    const sx = Math.min(sw - cw, Math.max(0, cropX * sw - cw / 2));
    ctx.drawImage(video, sx, 0, cw, sh, 0, 0, W, H);
  } else {
    const ch = sw / tAR;
    const sy = Math.min(sh - ch, Math.max(0, sh * 0.4 - ch / 2));
    ctx.drawImage(video, 0, sy, sw, ch, 0, 0, W, H);
  }
}

function wrapWords(ctx: CanvasRenderingContext2D, words: string[], maxW: number, space: number): number[][] {
  const lines: number[][] = [[]];
  let width = 0;
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width;
    const cur = lines[lines.length - 1];
    if (cur.length && width + space + ww > maxW) {
      lines.push([i]);
      width = ww;
    } else {
      width += (cur.length ? space : 0) + ww;
      cur.push(i);
    }
  });
  return lines;
}

/** Desenha a legenda do instante `t` (timeline de saída) com o estilo escolhido. */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  line: CaptionLine | null,
  t: number,
  style: CaptionStyle,
  W: number,
  H: number,
  hasTitle: boolean,
) {
  if (!style.enabled || !line) return;
  const scale = W / 1080;
  const fs = style.fontSize * scale;
  const weight = style.bold ? 800 : 500;
  ctx.save();
  ctx.font = `${weight} ${fs}px "${style.font}", "Inter", system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const words = line.words.map((w) => (style.uppercase ? w.w.toLocaleUpperCase("pt-BR") : w.w));
  const space = ctx.measureText(" ").width;
  const maxW = W - 140 * scale;
  const rows = wrapWords(ctx, words, maxW, space);
  const lineH = fs * 1.18;
  const blockH = rows.length * lineH;
  let top: number;
  if (style.position === "bottom") top = H * 0.8 - blockH;
  else if (style.position === "top") top = H * (hasTitle ? 0.24 : 0.14);
  else top = H / 2 - blockH / 2;

  // índice da palavra falada
  let current = -1;
  if (style.highlightMode === "word") {
    for (let j = 0; j < line.words.length; j++) {
      const s = j === 0 ? line.start : line.words[j].s;
      const e = j + 1 < line.words.length ? line.words[j + 1].s : line.end;
      if (t >= s && t < e) current = j;
    }
  }
  // animação de entrada
  const age = t - line.start;
  let lineScale = 1;
  let alpha = 1;
  if (style.animation === "pop" && age < 0.09) lineScale = 0.82 + (0.18 * age) / 0.09;
  if (style.animation === "fade" && age < 0.12) alpha = 0.3 + (0.7 * age) / 0.12;
  ctx.globalAlpha = alpha;
  const cx = W / 2;
  const cy = top + blockH / 2;
  ctx.translate(cx, cy);
  ctx.scale(lineScale, lineScale);
  ctx.translate(-cx, -cy);

  rows.forEach((idxs, r) => {
    const widths = idxs.map((i) => ctx.measureText(words[i]).width);
    const rowW = widths.reduce((a, b) => a + b, 0) + space * (idxs.length - 1);
    let x = (W - rowW) / 2;
    const baseline = top + r * lineH + fs * 0.95;
    if (style.background === "box") {
      const pad = fs * 0.22;
      ctx.fillStyle = rgba(style.backgroundColor, style.backgroundOpacity);
      ctx.beginPath();
      ctx.roundRect(x - pad, baseline - fs * 0.95 - pad * 0.4, rowW + pad * 2, lineH + pad * 0.6, fs * 0.16);
      ctx.fill();
    }
    idxs.forEach((i, k) => {
      const word = words[i];
      const w = widths[k];
      const isCurrent = i === current;
      const isKeyword = line.words[i].keyword && (style.highlightMode === "keywords" || style.highlightKeywords);
      ctx.save();
      if (isCurrent) {
        const wx = x + w / 2;
        const wy = baseline - fs * 0.35;
        ctx.translate(wx, wy);
        ctx.scale(1.08, 1.08);
        ctx.translate(-wx, -wy);
      }
      if (style.background === "shadow" || style.background === "none") {
        ctx.lineJoin = "round";
        ctx.lineWidth = fs * (style.background === "shadow" ? 0.16 : 0.09);
        ctx.strokeStyle = style.background === "shadow" ? rgba(style.backgroundColor, style.backgroundOpacity) : "rgba(0,0,0,0.85)";
        if (style.background === "shadow") {
          ctx.shadowColor = rgba(style.backgroundColor, style.backgroundOpacity * 0.6);
          ctx.shadowBlur = fs * 0.12;
          ctx.shadowOffsetY = fs * 0.05;
        }
        ctx.strokeText(word, x, baseline);
        ctx.shadowColor = "transparent";
      }
      ctx.fillStyle = isCurrent || isKeyword ? style.highlightColor : style.color;
      ctx.fillText(word, x, baseline);
      ctx.restore();
      x += w + space;
    });
  });
  ctx.restore();
}

export function drawTitle(ctx: CanvasRenderingContext2D, title: string, t: number, W: number, H: number) {
  if (!title || t > 4.5) return;
  const scale = W / 1080;
  const fs = 58 * scale;
  ctx.save();
  ctx.globalAlpha = t < 0.15 ? t / 0.15 : t > 4.25 ? Math.max(0, (4.5 - t) / 0.25) : 1;
  ctx.font = `800 ${fs}px "Montserrat", "Inter", system-ui, sans-serif`;
  const words = title.split(/\s+/);
  const space = ctx.measureText(" ").width;
  const rows = wrapWords(ctx, words, W - 220 * scale, space);
  const lineH = fs * 1.2;
  const pad = 22 * scale;
  let y = H * 0.08;
  for (const idxs of rows) {
    const text = idxs.map((i) => words[i]).join(" ");
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.roundRect((W - tw) / 2 - pad, y, tw + pad * 2, lineH + pad * 0.6, 12 * scale);
    ctx.fill();
    ctx.fillStyle = "#0B0B0F";
    ctx.fillText(text, (W - tw) / 2, y + fs * 1.02);
    y += lineH + pad * 0.6;
  }
  ctx.restore();
}

export type RenderJob = {
  video: HTMLVideoElement;
  audioDest: MediaStreamAudioDestinationNode;
  segments: TimeRange[];
  lines: CaptionLine[];
  style: CaptionStyle;
  title: string;
  aspect: Aspect;
  layout: LayoutMode;
  /** Posição manual (0..1) ou null para seguir o rosto detectado. */
  cropX: number | null;
  framing: Framing | null;
  format: { mime: string; ext: "mp4" | "webm" };
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
};

const waitEvent = (el: HTMLElement, name: string) => new Promise<void>((r) => el.addEventListener(name, () => r(), { once: true }));

async function seek(video: HTMLVideoElement, t: number) {
  if (Math.abs(video.currentTime - t) < 0.01) return;
  const done = waitEvent(video, "seeked");
  video.currentTime = t;
  await done;
}

/** Grava o corte em tempo real. Retorna o vídeo final e uma capa (JPEG). */
export async function renderClip(job: RenderJob): Promise<{ blob: Blob; poster: string }> {
  const { w: W, h: H } = SIZES[job.aspect];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const stream = canvas.captureStream(30);
  const tracks = [...stream.getVideoTracks(), ...job.audioDest.stream.getAudioTracks()];
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: job.format.mime,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 160_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  const total = job.segments.reduce((a, s) => a + (s.e - s.s), 0);
  let poster = "";
  let acc = 0;
  let segIndex = 0;
  const outTime = () => acc + Math.max(0, job.video.currentTime - job.segments[segIndex].s);
  const draw = () => {
    const t = outTime();
    const x = job.cropX ?? (job.framing ? framingXAt(job.framing, t) : 0.5);
    drawVideoFrame(ctx, job.video, W, H, job.layout, x);
    drawTitle(ctx, job.title, t, W, H);
    const line = job.lines.find((l) => t >= l.start && t < l.end) ?? null;
    drawCaption(ctx, line, t, job.style, W, H, Boolean(job.title));
    if (!poster && t >= Math.min(0.8, total / 2)) poster = canvas.toDataURL("image/jpeg", 0.82);
  };

  try {
    for (segIndex = 0; segIndex < job.segments.length; segIndex++) {
      const seg = job.segments[segIndex];
      await seek(job.video, seg.s);
      draw();
      if (segIndex === 0) recorder.start(500);
      else recorder.resume();
      await job.video.play();
      await new Promise<void>((resolve, reject) => {
        let raf = 0;
        const tick = () => {
          if (job.signal?.aborted) {
            cancelAnimationFrame(raf);
            reject(new DOMException("Cancelado", "AbortError"));
            return;
          }
          // aba em segundo plano: pausa tudo para não gravar quadros congelados
          if (document.hidden) {
            if (!job.video.paused) {
              job.video.pause();
              recorder.pause();
            }
            raf = requestAnimationFrame(tick);
            return;
          }
          if (job.video.paused && recorder.state === "paused" && job.video.currentTime < seg.e) {
            recorder.resume();
            void job.video.play();
          }
          draw();
          job.onProgress(Math.min(1, outTime() / total));
          if (job.video.currentTime >= seg.e || job.video.ended) {
            resolve();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
      job.video.pause();
      recorder.pause();
      acc += seg.e - seg.s;
    }
  } finally {
    job.video.pause();
    if (recorder.state !== "inactive") recorder.stop();
  }
  await stopped;
  if (!poster) poster = canvas.toDataURL("image/jpeg", 0.82);
  return { blob: new Blob(chunks, { type: job.format.mime.split(";")[0] }), poster };
}
