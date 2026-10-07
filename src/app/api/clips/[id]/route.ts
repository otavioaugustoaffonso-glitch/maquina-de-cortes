import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCaptionStyle } from "@/lib/captions/styles";
import { BUCKETS } from "@/lib/constants";
import { ApiError, handler, parseBody, requireUser } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

const wordSchema = z.object({ w: z.string().min(1).max(60), s: z.number().nonnegative(), e: z.number().nonnegative() });

const patchSchema = z
  .object({
    title: z.string().trim().max(140),
    description: z.string().trim().max(1000),
    social_caption: z.string().trim().max(2200),
    hashtags: z.array(z.string().trim().max(60)).max(20),
    title_on_screen: z.string().trim().max(80),
    start_time: z.number().nonnegative(),
    end_time: z.number().positive(),
    caption_style: z.record(z.string(), z.unknown()),
    caption_words: z.array(wordSchema).max(3000).nullable(),
    format: z.object({ aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]), layout: z.enum(["fill", "fit"]) }),
    remove_silences: z.boolean(),
    show_title: z.boolean(),
    approved: z.boolean(),
  })
  .partial();

export const PATCH = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const body = await parseBody(req, patchSchema);

  const { data: clip } = await supabase.from("clips").select("id, video_id, start_time, end_time, status").eq("id", id).maybeSingle();
  if (!clip) throw new ApiError(404, "Corte não encontrado");

  const { approved, caption_style, ...rest } = body;
  const update: Record<string, unknown> = { ...rest };
  if (caption_style) update.caption_style = resolveCaptionStyle(caption_style);
  if (rest.hashtags) update.hashtags = rest.hashtags.filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""));

  if (rest.start_time != null || rest.end_time != null) {
    const start = rest.start_time ?? Number(clip.start_time);
    const end = rest.end_time ?? Number(clip.end_time);
    const { data: video } = await supabase.from("videos").select("duration_seconds").eq("id", clip.video_id).single();
    const max = Number(video?.duration_seconds ?? Infinity);
    if (end <= start) throw new ApiError(400, "O fim precisa ser depois do início.");
    if (end - start < 3) throw new ApiError(400, "O corte precisa ter pelo menos 3 segundos.");
    if (end - start > 300) throw new ApiError(400, "O corte pode ter no máximo 5 minutos.");
    if (end > max + 0.5) throw new ApiError(400, "O fim ultrapassa a duração do vídeo.");
    // Mudou o intervalo: legendas editadas manualmente deixam de corresponder
    if (body.caption_words === undefined) update.caption_words = null;
  }
  if (approved !== undefined) {
    if (!["ready", "approved"].includes(clip.status)) throw new ApiError(409, "Só é possível aprovar cortes já renderizados.");
    update.status = approved ? "approved" : "ready";
    update.approved_at = approved ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase.from("clips").update(update).eq("id", id).select("*").single();
  if (error) throw new ApiError(400, "Não foi possível salvar as alterações.");
  return NextResponse.json(data);
});

export const DELETE = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data: clip } = await supabase.from("clips").select("id, output_path, thumbnail_path").eq("id", id).maybeSingle();
  if (!clip) throw new ApiError(404, "Corte não encontrado");
  const files = [clip.output_path, clip.thumbnail_path].filter(Boolean) as string[];
  if (files.length) await createAdminClient().storage.from(BUCKETS.clips).remove(files);
  await supabase.from("clips").delete().eq("id", id);
  return NextResponse.json({ ok: true });
});
