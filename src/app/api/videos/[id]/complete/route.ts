import { NextResponse } from "next/server";
import { BUCKETS } from "@/lib/constants";
import { ApiError, handler, requireUser } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

/** Chamado pelo navegador ao terminar o upload: valida o arquivo e enfileira o processamento. */
export const POST = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { user, supabase } = await requireUser(req);

  const { data: video } = await supabase.from("videos").select("id, user_id, storage_path, size_bytes, status").eq("id", id).maybeSingle();
  if (!video) throw new ApiError(404, "Vídeo não encontrado");
  if (video.status !== "uploading") return NextResponse.json({ ok: true, status: video.status });

  // Confirma que o objeto existe e tem o tamanho declarado
  const admin = createAdminClient();
  const dir = video.storage_path.slice(0, video.storage_path.lastIndexOf("/"));
  const file = video.storage_path.slice(video.storage_path.lastIndexOf("/") + 1);
  const { data: objects } = await admin.storage.from(BUCKETS.videos).list(dir, { search: file });
  const obj = objects?.find((o) => o.name === file);
  if (!obj) throw new ApiError(409, "Upload não encontrado no armazenamento.");
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  if (size && Math.abs(size - Number(video.size_bytes)) > 1024) {
    await admin.from("videos").update({ size_bytes: size }).eq("id", id);
  }

  await admin.from("videos").update({ status: "queued", progress: 0 }).eq("id", id);
  const { error } = await admin.from("jobs").insert({ type: "process_video", user_id: user.id, payload: { videoId: id }, priority: 100 });
  if (error) throw new ApiError(500, "Não foi possível enfileirar o processamento.");
  return NextResponse.json({ ok: true, status: "queued" });
});
