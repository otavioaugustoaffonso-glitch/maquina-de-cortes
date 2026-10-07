import { NextResponse } from "next/server";
import { z } from "zod";
import { BUCKETS } from "@/lib/constants";
import { ApiError, handler, parseBody, requireUser } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

export const PATCH = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const body = await parseBody(req, z.object({ name: z.string().trim().min(1).max(200) }));
  const { data, error } = await supabase.from("projects").update({ name: body.name }).eq("id", id).select("id, name").maybeSingle();
  if (error || !data) throw new ApiError(404, "Projeto não encontrado");
  return NextResponse.json(data);
});

/** Exclui o projeto, seus registros (cascade) e TODOS os arquivos no Storage. */
export const DELETE = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data: project } = await supabase.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) throw new ApiError(404, "Projeto não encontrado");

  const [{ data: videos }, { data: clips }, { data: exportsRows }] = await Promise.all([
    supabase.from("videos").select("storage_path, proxy_path, audio_path").eq("project_id", id),
    supabase.from("clips").select("output_path, thumbnail_path").eq("project_id", id),
    supabase.from("exports").select("storage_path").eq("project_id", id),
  ]);
  const admin = createAdminClient();
  const videoFiles = (videos ?? []).flatMap((v) => [v.storage_path, v.proxy_path, v.audio_path]).filter(Boolean) as string[];
  const clipFiles = (clips ?? []).flatMap((c) => [c.output_path, c.thumbnail_path]).filter(Boolean) as string[];
  const exportFiles = (exportsRows ?? []).map((e) => e.storage_path).filter(Boolean) as string[];
  await Promise.all([
    videoFiles.length && admin.storage.from(BUCKETS.videos).remove(videoFiles),
    clipFiles.length && admin.storage.from(BUCKETS.clips).remove(clipFiles),
    exportFiles.length && admin.storage.from(BUCKETS.exports).remove(exportFiles),
  ]);
  // Cancela jobs pendentes deste projeto
  const videoIds = (await supabase.from("videos").select("id").eq("project_id", id)).data?.map((v) => v.id) ?? [];
  for (const vid of videoIds) {
    await admin.from("jobs").update({ status: "cancelled" }).eq("status", "queued").filter("payload->>videoId", "eq", vid);
  }
  await supabase.from("projects").delete().eq("id", id);
  return NextResponse.json({ ok: true });
});
