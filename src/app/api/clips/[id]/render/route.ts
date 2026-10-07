import { NextResponse } from "next/server";
import { ApiError, handler, requireUser } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

/** (Re)gera o vídeo do corte com as configurações atuais. Só FFmpeg — sem custo de IA. */
export const POST = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { user, supabase } = await requireUser(req);
  const { data: clip } = await supabase.from("clips").select("id, video_id, status").eq("id", id).maybeSingle();
  if (!clip) throw new ApiError(404, "Corte não encontrado");

  const admin = createAdminClient();
  // Evita jobs duplicados na fila para o mesmo corte
  const { data: pending } = await admin
    .from("jobs")
    .select("id")
    .eq("type", "render_clip")
    .eq("status", "queued")
    .filter("payload->>clipId", "eq", id)
    .limit(1);
  await admin.from("clips").update({ status: "queued", render_stage: null, render_error: null, approved_at: null }).eq("id", id);
  if (!pending?.length) {
    await admin.from("jobs").insert({ type: "render_clip", user_id: user.id, payload: { clipId: id, videoId: clip.video_id }, priority: 10 });
  }
  return NextResponse.json({ ok: true, status: "queued" });
});
