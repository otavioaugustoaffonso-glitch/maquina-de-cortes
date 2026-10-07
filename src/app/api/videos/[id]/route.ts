import { NextResponse } from "next/server";
import { BUCKETS } from "@/lib/constants";
import { ApiError, handler, requireUser } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

/** Status do processamento (polling leve do frontend). */
export const GET = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data } = await supabase.from("videos").select("id, status, progress, status_message, error, duration_seconds").eq("id", id).maybeSingle();
  if (!data) throw new ApiError(404, "Vídeo não encontrado");
  return NextResponse.json(data);
});

/** Cancela um upload em andamento: remove o arquivo parcial e o projeto. */
export const DELETE = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data: video } = await supabase.from("videos").select("id, project_id, storage_path, status").eq("id", id).maybeSingle();
  if (!video) throw new ApiError(404, "Vídeo não encontrado");
  if (video.status !== "uploading") throw new ApiError(409, "O vídeo já foi enviado; exclua o projeto.");
  const admin = createAdminClient();
  await admin.storage.from(BUCKETS.videos).remove([video.storage_path]);
  await supabase.from("projects").delete().eq("id", video.project_id);
  return NextResponse.json({ ok: true });
});
