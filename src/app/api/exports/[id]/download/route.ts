import { NextResponse } from "next/server";
import { BUCKETS } from "@/lib/constants";
import { ApiError, handler, requireUser } from "@/lib/server/api";

export const GET = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data: exp } = await supabase.from("exports").select("storage_path, status").eq("id", id).maybeSingle();
  if (!exp || exp.status !== "ready" || !exp.storage_path) throw new ApiError(404, "Exportação indisponível");
  const { data } = await supabase.storage.from(BUCKETS.exports).createSignedUrl(exp.storage_path, 600, { download: "cortes.zip" });
  if (!data) throw new ApiError(500, "Falha ao gerar link");
  return NextResponse.redirect(data.signedUrl);
});
