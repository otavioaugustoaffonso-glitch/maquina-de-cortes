import { notFound } from "next/navigation";
import { ProjectView } from "@/components/project/project-view";
import type { ClipRow, ExportRow, ProjectRow, VideoRow } from "@/lib/db-types";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Projeto" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const [{ data: videos }, { data: clips }, { data: exportsRows }] = await Promise.all([
    supabase.from("videos").select("*").eq("project_id", id).order("created_at").limit(1),
    supabase.from("clips").select("*").eq("project_id", id).order("rank"),
    supabase.from("exports").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  return (
    <ProjectView
      project={project as ProjectRow}
      initialVideo={(videos?.[0] as VideoRow) ?? null}
      initialClips={(clips ?? []) as ClipRow[]}
      initialExports={(exportsRows ?? []) as ExportRow[]}
    />
  );
}
