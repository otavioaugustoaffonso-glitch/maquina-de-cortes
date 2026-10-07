import { FolderOpen, Plus } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { ButtonLink, EmptyState } from "@/components/ui";
import { listProjects } from "@/lib/server/projects";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Projetos" };

export default async function ProjectsPage() {
  const supabase = await createClient();
  const projects = await listProjects(supabase, 200);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
          <p className="mt-1 text-sm text-muted">{projects.length} projeto(s)</p>
        </div>
        <ButtonLink href="/projects/new">
          <Plus className="size-4" /> Novo projeto
        </ButtonLink>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={<FolderOpen className="size-5" />} title="Nenhum projeto" description="Crie um projeto enviando um vídeo longo." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
