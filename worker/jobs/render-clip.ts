import fs from "node:fs/promises";
import path from "node:path";
import { buildAss } from "@/lib/captions/ass";
import { resolveCaptionStyle } from "@/lib/captions/styles";
import { computeKeepSegments, remapWords, wordsInRange, type TimeRange } from "@/lib/clips/timing";
import { BUCKETS, OUTPUT_SIZES } from "@/lib/constants";
import type { ClipFormat, Word } from "@/lib/types";
import { log } from "../log";
import { computeFraming } from "../media/framing";
import { probe } from "../media/ffmpeg";
import { makeThumbnail, renderClip } from "../media/render";
import { PermanentError, type Job } from "../queue";
import { removeObjects, uploadFile } from "../storage";
import { db, must } from "../supabase";
import { ensureProxyLocal, ensureSourceLocal, getVideo, recordUsage, setVideoStatus, videoWorkDir } from "./common";

type ClipRow = {
  id: string;
  video_id: string;
  project_id: string;
  user_id: string;
  start_time: number;
  end_time: number;
  title: string;
  title_on_screen: string | null;
  keywords: string[];
  caption_style: unknown;
  caption_words: Word[] | null;
  format: ClipFormat;
  remove_silences: boolean;
  show_title: boolean;
  output_path: string | null;
  thumbnail_path: string | null;
};

async function stage(clipId: string, renderStage: string) {
  await db().from("clips").update({ render_stage: renderStage }).eq("id", clipId);
}

/**
 * Renderiza um corte: recorte + remoção de pausas + enquadramento 9:16 +
 * legendas animadas + título na tela -> MP4 H.264/AAC + thumbnail.
 * Não usa IA: todo o trabalho aqui é FFmpeg/OpenCV local.
 */
export async function renderClipJob(job: Job, beat: () => Promise<void>): Promise<void> {
  const clipId = String(job.payload.clipId);
  const { data: clipData } = await db().from("clips").select("*").eq("id", clipId).maybeSingle();
  if (!clipData) {
    log.info("corte removido antes da renderização", { clipId });
    return;
  }
  const clip = clipData as ClipRow;
  const video = await getVideo(clip.video_id);
  await must(db().from("clips").update({ status: "rendering", render_stage: "preparing", render_error: null }).eq("id", clipId), "status do corte");

  try {
    const start = Number(clip.start_time);
    const end = Number(clip.end_time);
    const transcript = (await must(
      db().from("transcripts").select("words").eq("video_id", clip.video_id).single(),
      "carregar transcrição",
    )) as { words: Word[] };
    const sourceWords = wordsInRange(transcript.words, start - 1, end + 1);
    const captionWords = clip.caption_words?.length ? clip.caption_words : wordsInRange(sourceWords, start, end);

    const source = await ensureSourceLocal(video);
    const info = video.width && video.height ? { width: video.width, height: video.height, fps: Number(video.fps) || 30 } : await probe(source);

    // Trechos a manter (remoção de silêncio/pausas longas)
    const segments: TimeRange[] = clip.remove_silences
      ? computeKeepSegments(sourceWords, start, end)
      : [{ s: start, e: end }];
    if (!segments.length) throw new PermanentError("Nenhum trecho com fala neste intervalo.");

    // Enquadramento automático (somente quando há recorte horizontal)
    const format: ClipFormat = { aspect: clip.format?.aspect ?? "9:16", layout: clip.format?.layout ?? "fill" };
    const { width: W, height: H } = OUTPUT_SIZES[format.aspect];
    const needsTracking = format.layout === "fill" && info.width / info.height > W / H + 0.01;
    await stage(clipId, needsTracking ? "framing" : "preparing");
    const proxy = await ensureProxyLocal(video);
    const framing = needsTracking
      ? await computeFraming(proxy ?? source, segments[0].s, segments[segments.length - 1].e, segments)
      : { mode: "center" as const, keyframes: [{ t: 0, x: 0.5 }] };
    await beat();

    // Legendas (ASS) no timeline de saída
    if (video.status === "generating_clips") await setVideoStatus(video.id, "adding_captions", 75);
    await stage(clipId, "captions");
    const dir = path.join(videoWorkDir(video.id), "clips", clipId);
    await fs.mkdir(dir, { recursive: true });
    const outWords = remapWords(captionWords, segments);
    const duration = segments.reduce((a, s) => a + (s.e - s.s), 0);
    const style = resolveCaptionStyle(clip.caption_style);
    const title = clip.show_title ? (clip.title_on_screen || clip.title || "").trim() : null;
    let assPath: string | null = null;
    if (style.enabled || title) {
      assPath = path.join(dir, "captions.ass");
      await fs.writeFile(assPath, buildAss({ words: outWords, style, width: W, height: H, duration, keywords: clip.keywords, title }));
    }

    // Encode
    await stage(clipId, "encoding");
    const output = path.join(dir, "clip.mp4");
    const t0 = Date.now();
    let lastBeat = Date.now();
    const result = await renderClip({
      input: source,
      source: info,
      clipStart: start,
      segments,
      format,
      framing,
      assPath,
      output,
      onProgress: () => {
        if (Date.now() - lastBeat > 20_000) {
          lastBeat = Date.now();
          void beat();
        }
      },
    });
    await stage(clipId, "uploading");
    const thumb = path.join(dir, "thumb.jpg");
    await makeThumbnail(output, thumb, Math.min(0.8, result.duration / 2));

    // Upload com nome versionado (evita cache do navegador após re-renderizar)
    const version = Date.now().toString(36);
    const base = `${clip.user_id}/${clip.project_id}/${clip.id}`;
    const outputPath = `${base}/clip-${version}.mp4`;
    const thumbPath = `${base}/thumb-${version}.jpg`;
    const size = await uploadFile(BUCKETS.clips, outputPath, output, "video/mp4");
    await uploadFile(BUCKETS.clips, thumbPath, thumb, "image/jpeg");
    // remove versões antigas
    await removeObjects(BUCKETS.clips, [clip.output_path ?? "", clip.thumbnail_path ?? ""]).catch(() => {});

    await must(
      db()
        .from("clips")
        .update({
          status: "ready",
          render_stage: "done",
          output_path: outputPath,
          thumbnail_path: thumbPath,
          output_size_bytes: size,
          output_duration_seconds: Math.round(result.duration * 1000) / 1000,
          framing,
          rendered_at: new Date().toISOString(),
          render_error: null,
        })
        .eq("id", clipId),
      "salvar corte renderizado",
    );
    await recordUsage(clip.user_id, clip.video_id, "render_seconds", Math.round(result.duration), "ffmpeg", { ms: Date.now() - t0 });
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    const final = e instanceof PermanentError || job.attempts >= job.max_attempts;
    await db()
      .from("clips")
      .update({ status: final ? "failed" : "queued", render_stage: null, render_error: e instanceof Error ? e.message.slice(0, 1000) : String(e) })
      .eq("id", clipId);
    if (final) await maybeFinishVideo(clip.video_id);
    throw e;
  }
  await maybeFinishVideo(clip.video_id);
}

/** Quando não há mais cortes na fila/renderizando, conclui o processamento do vídeo. */
export async function maybeFinishVideo(videoId: string) {
  const { count } = await db()
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId)
    .in("status", ["queued", "rendering"]);
  const video = await getVideo(videoId);
  if (["completed", "failed"].includes(video.status)) return;
  if ((count ?? 0) > 0) {
    const { count: total } = await db().from("clips").select("id", { count: "exact", head: true }).eq("video_id", videoId).neq("status", "suggested");
    const done = (total ?? 0) - (count ?? 0);
    await setVideoStatus(videoId, video.status === "generating_clips" ? "generating_clips" : "adding_captions", 72 + (done / Math.max(1, total ?? 1)) * 25);
    return;
  }
  await setVideoStatus(videoId, "finalizing", 98);
  await setVideoStatus(videoId, "completed", 100, { processing_finished_at: new Date().toISOString() });
}
