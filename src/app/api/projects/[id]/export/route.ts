import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handler, parseBody, requireUser } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

/** Lista as exportações (zips) do projeto. */
export const GET = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { supabase } = await requireUser(req);
  const { data } = await supabase.from("exports").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(10);
  return NextResponse.json(data ?? []);
});

/** Cria um pacote .zip com os cortes informados (padrão: todos os aprovados). */
export const POST = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { user, supabase } = await requireUser(req);
  const body = await parseBody(req, z.object({ clipIds: z.array(z.string().uuid()).max(100).optional() }));

  let query = supabase.from("clips").select("id").eq("project_id", id).not("output_path", "is", null);
  query = body.clipIds?.length ? query.in("id", body.clipIds) : query.eq("status", "approved");
  const { data: clips } = await query;
  if (!clips?.length) throw new ApiError(400, "Nenhum corte renderizado/aprovado para exportar.");

  const admin = createAdminClient();
  const { data: exp, error } = await admin
    .from("exports")
    .insert({ project_id: id, user_id: user.id, clip_ids: clips.map((c) => c.id) })
    .select("*")
    .single();
  if (error || !exp) throw new ApiError(500, "Falha ao criar exportação.");
  await admin.from("jobs").insert({ type: "export_zip", user_id: user.id, payload: { exportId: exp.id }, priority: 20 });
  return NextResponse.json(exp, { status: 201 });
});
