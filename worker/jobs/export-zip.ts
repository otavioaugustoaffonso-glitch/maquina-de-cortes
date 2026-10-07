import { ZipArchive } from "archiver";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { BUCKETS } from "@/lib/constants";
import { formatDuration, slugify } from "@/lib/format";
import { env } from "../env";
import { log } from "../log";
import { PermanentError, type Job } from "../queue";
import { downloadToFile, removeObjects, uploadFile } from "../storage";
import { db, must } from "../supabase";

type ExportClip = {
  id: string;
  rank: number;
  title: string;
  description: string;
  social_caption: string;
  hashtags: string[];
  score: number;
  output_path: string | null;
  thumbnail_path: string | null;
  output_duration_seconds: number | null;
};

/** Gera um .zip com os cortes aprovados + um arquivo com títulos/legendas/hashtags. */
export async function exportZipJob(job: Job, beat: () => Promise<void>): Promise<void> {
  const exportId = String(job.payload.exportId);
  const exp = (await must(db().from("exports").select("*").eq("id", exportId).single(), "carregar exportação")) as {
    id: string;
    user_id: string;
    project_id: string;
    clip_ids: string[];
  };
  await db().from("exports").update({ status: "processing", error: null }).eq("id", exportId);

  const dir = path.join(env.tmpDir, "exports", exportId);
  await fsp.mkdir(dir, { recursive: true });
  try {
    const clips = (await must(
      db()
        .from("clips")
        .select("id, rank, title, description, social_caption, hashtags, score, output_path, thumbnail_path, output_duration_seconds")
        .in("id", exp.clip_ids)
        .eq("user_id", exp.user_id) // defesa extra: só cortes do dono
        .not("output_path", "is", null)
        .order("rank"),
      "listar cortes",
    )) as ExportClip[];
    if (!clips.length) throw new PermanentError("Nenhum corte renderizado para exportar.");

    const zipPath = path.join(dir, "cortes.zip");
    const archive = new ZipArchive({ store: true }); // MP4 já é comprimido
    const done = pipeline(archive, fs.createWriteStream(zipPath));

    const manifest: string[] = [];
    for (const [i, c] of clips.entries()) {
      const name = `${String(i + 1).padStart(2, "0")}-${slugify(c.title)}`;
      const local = path.join(dir, `${c.id}.mp4`);
      await downloadToFile(BUCKETS.clips, c.output_path!, local);
      archive.file(local, { name: `${name}.mp4` });
      if (c.thumbnail_path) {
        const thumb = path.join(dir, `${c.id}.jpg`);
        await downloadToFile(BUCKETS.clips, c.thumbnail_path, thumb);
        archive.file(thumb, { name: `capas/${name}.jpg` });
      }
      manifest.push(
        [
          `#${String(i + 1).padStart(2, "0")} — ${c.title}`,
          `Arquivo: ${name}.mp4 | Duração: ${formatDuration(c.output_duration_seconds)} | Potencial: ${c.score}/100`,
          `Descrição: ${c.description}`,
          `Legenda sugerida:\n${c.social_caption}`,
          `Hashtags: ${c.hashtags.join(" ")}`,
        ].join("\n"),
      );
      await beat();
    }
    archive.append(manifest.join("\n\n----------------------------------------\n\n"), { name: "legendas-e-hashtags.txt" });
    await archive.finalize();
    await done;

    const objectPath = `${exp.user_id}/${exp.project_id}/exports/${exportId}.zip`;
    const size = await uploadFile(BUCKETS.exports, objectPath, zipPath, "application/zip");
    await must(
      db()
        .from("exports")
        .update({
          status: "ready",
          storage_path: objectPath,
          size_bytes: size,
          expires_at: new Date(Date.now() + env.exportTtlDays * 86400_000).toISOString(),
        })
        .eq("id", exportId),
      "salvar exportação",
    );
  } catch (e) {
    const final = e instanceof PermanentError || job.attempts >= job.max_attempts;
    if (final) await db().from("exports").update({ status: "failed", error: String(e instanceof Error ? e.message : e) }).eq("id", exportId);
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Remove pacotes expirados do Storage (executado periodicamente pelo worker). */
export async function cleanupExpiredExports(): Promise<void> {
  const { data } = await db()
    .from("exports")
    .select("id, storage_path")
    .eq("status", "ready")
    .lt("expires_at", new Date().toISOString())
    .limit(100);
  const rows = (data ?? []) as { id: string; storage_path: string | null }[];
  if (!rows.length) return;
  await removeObjects(BUCKETS.exports, rows.map((r) => r.storage_path ?? "")).catch((e) => log.warn("limpeza de exports", { error: String(e) }));
  await db().from("exports").update({ status: "expired", storage_path: null }).in("id", rows.map((r) => r.id));
  log.info("exports expirados removidos", { count: rows.length });
}
