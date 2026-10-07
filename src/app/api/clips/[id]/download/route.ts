import { NextResponse } from "next/server";
import { BUCKETS } from "@/lib/constants";
import { slugify } from "@/lib/format";
import { ApiError, handler, requireUser } from "@/lib/server/api";

/** Download individual do corte (URL assinada de curta duração). */
export const GET = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data: clip } = await supabase.from("clips").select("output_path, title, rank").eq("id", id).maybeSingle();
  if (!clip?.output_path) throw new ApiError(404, "Corte ainda não renderizado");
  const filename = `${String(clip.rank).padStart(2, "0")}-${slugify(clip.title)}.mp4`;
  const { data } = await supabase.storage.from(BUCKETS.clips).createSignedUrl(clip.output_path, 600, { download: filename });
  if (!data) throw new ApiError(500, "Falha ao gerar link");
  return NextResponse.redirect(data.signedUrl);
});
