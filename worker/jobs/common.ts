import fs from "node:fs/promises";
import path from "node:path";
import { BUCKETS } from "@/lib/constants";
import type { VideoStatus } from "@/lib/types";
import { env } from "../env";
import { log } from "../log";
import { downloadToFile } from "../storage";
import { db, must } from "../supabase";

export type VideoRow = {
  id: string;
  project_id: string;
  user_id: string;
  original_filename: string;
  storage_path: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  proxy_path: string | null;
  status: VideoStatus;
};

export async function getVideo(id: string): Promise<VideoRow> {
  return must(db().from("videos").select("*").eq("id", id).single(), "carregar vídeo") as Promise<VideoRow>;
}

export async function setVideoStatus(id: string, status: VideoStatus, progress: number, extra: Record<string, unknown> = {}) {
  await must(
    db().from("videos").update({ status, progress: Math.round(Math.min(100, Math.max(0, progress))), ...extra }).eq("id", id),
    "atualizar status do vídeo",
  );
  log.info("status", { videoId: id, status, progress: Math.round(progress) });
}

export function videoWorkDir(videoId: string) {
  return path.join(env.tmpDir, "videos", videoId);
}

/**
 * Garante o vídeo original em disco local (cache por vídeo).
 * Vários jobs de renderização do mesmo vídeo reaproveitam o download.
 */
export async function ensureSourceLocal(video: VideoRow): Promise<string> {
  const dir = videoWorkDir(video.id);
  const ext = path.extname(video.storage_path) || ".mp4";
  const file = path.join(dir, `source${ext}`);
  try {
    const st = await fs.stat(file);
    if (st.size === Number(video.size_bytes)) {
      await fs.utimes(file, new Date(), new Date()); // marca uso recente (limpeza de cache)
      return file;
    }
  } catch {
    /* não existe */
  }
  log.info("baixando original", { videoId: video.id, bytes: video.size_bytes });
  await downloadToFile(BUCKETS.videos, video.storage_path, file);
  return file;
}

/** Proxy leve (540p) em disco local, se existir — mais rápido para detecção de rosto. */
export async function ensureProxyLocal(video: VideoRow): Promise<string | null> {
  if (!video.proxy_path) return null;
  const file = path.join(videoWorkDir(video.id), "proxy.mp4");
  try {
    await fs.stat(file);
    return file;
  } catch {
    try {
      await downloadToFile(BUCKETS.videos, video.proxy_path, file);
      return file;
    } catch (e) {
      log.warn("proxy indisponível", { error: String(e) });
      return null;
    }
  }
}

export async function recordUsage(userId: string, videoId: string | null, kind: string, amount: number, provider?: string, metadata: Record<string, unknown> = {}) {
  const { error } = await db().from("usage_events").insert({ user_id: userId, video_id: videoId, kind, amount, provider, metadata });
  if (error) log.warn("falha ao registrar uso", { error: error.message });
}

/** Remove do disco caches de vídeos não usados há mais de WORKER_CACHE_TTL_HOURS. */
export async function cleanupCache(): Promise<void> {
  const root = path.join(env.tmpDir, "videos");
  const cutoff = Date.now() - env.cacheTtlHours * 3600 * 1000;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const dir = path.join(root, name);
    try {
      const files = await fs.readdir(dir);
      const stats = await Promise.all(files.map((f) => fs.stat(path.join(dir, f))));
      const newest = Math.max(0, ...stats.map((s) => s.mtimeMs));
      if (newest < cutoff) {
        await fs.rm(dir, { recursive: true, force: true });
        log.info("cache removido", { dir });
      }
    } catch {
      /* ignora */
    }
  }
}
