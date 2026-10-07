import { notFound } from "next/navigation";
import { ClipEditor } from "@/components/editor/clip-editor";
import { wordsInRange } from "@/lib/clips/timing";
import { BUCKETS } from "@/lib/constants";
import type { ClipRow, VideoRow } from "@/lib/db-types";
import type { Word } from "@/lib/types";
import { signPaths } from "@/lib/server/media";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Editor de corte" };

/** Janela de transcrição carregada ao redor do corte (permite estender início/fim). */
const CONTEXT_SECONDS = 90;

export default async function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId } = await params;
  const supabase = await createClient();
  const { data: clip } = await supabase.from("clips").select("*").eq("id", clipId).eq("project_id", id).maybeSingle();
  if (!clip) notFound();
  const c = clip as ClipRow;
  const [{ data: video }, { data: transcript }, { count }] = await Promise.all([
    supabase.from("videos").select("*").eq("id", c.video_id).single(),
    supabase.from("transcripts").select("words").eq("video_id", c.video_id).maybeSingle(),
    supabase.from("clips").select("id", { count: "exact", head: true }).eq("project_id", id),
  ]);
  const v = video as VideoRow;
  const allWords = ((transcript?.words ?? []) as Word[]);
  const windowStart = Math.max(0, c.start_time - CONTEXT_SECONDS);
  const windowEnd = Math.min(Number(v.duration_seconds ?? c.end_time + CONTEXT_SECONDS), c.end_time + CONTEXT_SECONDS);
  const words = wordsInRange(allWords, windowStart, windowEnd);

  const [videoUrls, clipUrls] = await Promise.all([
    signPaths(supabase, BUCKETS.videos, [v.proxy_path ?? v.storage_path], 6 * 3600),
    signPaths(supabase, BUCKETS.clips, [c.output_path], 6 * 3600),
  ]);

  return (
    <ClipEditor
      initialClip={c}
      video={{
        id: v.id,
        duration: Number(v.duration_seconds ?? 0),
        width: v.width ?? 1920,
        height: v.height ?? 1080,
        sourceUrl: videoUrls.get(v.proxy_path ?? v.storage_path) ?? null,
        isProxy: Boolean(v.proxy_path),
      }}
      words={words}
      window={{ start: windowStart, end: windowEnd }}
      outputUrl={c.output_path ? (clipUrls.get(c.output_path) ?? null) : null}
      clipCount={count ?? 0}
    />
  );
}
