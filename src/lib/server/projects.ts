import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKETS } from "../constants";
import type { ProjectRow, VideoRow } from "../db-types";
import { signPaths } from "./media";

export type ProjectSummary = ProjectRow & {
  video: Pick<VideoRow, "id" | "status" | "progress" | "duration_seconds" | "original_filename" | "size_bytes" | "error"> | null;
  clipCount: number;
  approvedCount: number;
  thumbnailUrl: string | null;
};

export async function listProjects(supabase: SupabaseClient, limit = 50): Promise<ProjectSummary[]> {
  const { data } = await supabase
    .from("projects")
    .select("*, videos(id, status, progress, duration_seconds, original_filename, size_bytes, error)")
    .order("created_at", { ascending: false })
    .limit(limit);
  const projects = (data ?? []) as (ProjectRow & { videos: ProjectSummary["video"][] })[];
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const { data: clips } = await supabase.from("clips").select("project_id, status, thumbnail_path, rank").in("project_id", ids).order("rank");
  const rows = (clips ?? []) as { project_id: string; status: string; thumbnail_path: string | null; rank: number }[];
  const thumbs = new Map<string, string>();
  for (const c of rows) if (c.thumbnail_path && !thumbs.has(c.project_id)) thumbs.set(c.project_id, c.thumbnail_path);
  const signed = await signPaths(supabase, BUCKETS.clips, [...thumbs.values()]);
  return projects.map(({ videos, ...p }) => ({
    ...p,
    video: videos?.[0] ?? null,
    clipCount: rows.filter((c) => c.project_id === p.id).length,
    approvedCount: rows.filter((c) => c.project_id === p.id && c.status === "approved").length,
    thumbnailUrl: thumbs.has(p.id) ? (signed.get(thumbs.get(p.id)!) ?? null) : null,
  }));
}
