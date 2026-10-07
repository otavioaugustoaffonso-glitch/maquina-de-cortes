import { NextResponse } from "next/server";
import { z } from "zod";
import { CAPTION_PRESETS } from "@/lib/captions/styles";
import { BUCKETS, resolveVideoMime } from "@/lib/constants";
import { ApiError, handler, parseBody, requireUser, serverLimits } from "@/lib/server/api";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(300),
  mimeType: z.string().max(100).optional().nullable(),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().positive().max(24 * 3600).optional().nullable(),
  settings: z
    .object({
      language: z.enum(["auto", "pt", "en", "es"]).default("auto"),
      captionPreset: z.enum(Object.keys(CAPTION_PRESETS) as [keyof typeof CAPTION_PRESETS]).default("highlight"),
      aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]).default("9:16"),
      layout: z.enum(["fill", "fit"]).default("fill"),
    })
    .default({ language: "auto", captionPreset: "highlight", aspect: "9:16", layout: "fill" }),
});

/**
 * Cria projeto + registro do vídeo e devolve o caminho para upload direto
 * (resumable/TUS) do navegador para o Supabase Storage — o arquivo NÃO passa
 * pelo servidor Next.js, o que permite vídeos de vários GB.
 */
export const POST = handler(async (req) => {
  const { user, supabase } = await requireUser(req);
  const body = await parseBody(req, schema);

  const mime = resolveVideoMime(body.filename, body.mimeType);
  if (!mime) throw new ApiError(415, "Formato não suportado. Use MP4, MOV, WEBM ou MKV.");
  if (body.sizeBytes > serverLimits.maxUploadBytes) {
    throw new ApiError(413, `Arquivo maior que o limite de ${Math.round(serverLimits.maxUploadBytes / 1024 ** 3)} GB.`);
  }

  // Limite de vídeos simultâneos em processamento por usuário (proteção de custo/abuso)
  const { count } = await supabase
    .from("videos")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(completed,failed)");
  if ((count ?? 0) >= serverLimits.maxConcurrentVideos) {
    throw new ApiError(429, "Você já tem vídeos em processamento. Aguarde a conclusão para enviar outro.");
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: body.name,
      settings: {
        language: body.settings.language,
        captionStyle: CAPTION_PRESETS[body.settings.captionPreset].style,
        format: { aspect: body.settings.aspect, layout: body.settings.layout },
      },
    })
    .select("id")
    .single();
  if (pErr || !project) throw new ApiError(500, "Não foi possível criar o projeto.");

  const ext = body.filename.toLowerCase().match(/\.(mp4|m4v|mov|webm|mkv)$/)?.[0] ?? ".mp4";
  const videoId = crypto.randomUUID();
  const objectPath = `${user.id}/${project.id}/${videoId}/original${ext}`;

  // Vídeos só são inseridos pelo backend (RLS bloqueia insert do client)
  const admin = createAdminClient();
  const { error: vErr } = await admin.from("videos").insert({
    id: videoId,
    project_id: project.id,
    user_id: user.id,
    original_filename: body.filename,
    storage_path: objectPath,
    mime_type: mime,
    size_bytes: body.sizeBytes,
    duration_seconds: body.durationSeconds ?? null,
    status: "uploading",
  });
  if (vErr) {
    await supabase.from("projects").delete().eq("id", project.id);
    throw new ApiError(500, "Não foi possível registrar o vídeo.");
  }

  return NextResponse.json({ projectId: project.id, videoId, bucket: BUCKETS.videos, objectPath, contentType: mime });
});
