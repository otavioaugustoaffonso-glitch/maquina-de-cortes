import { CheckCircle2, Clock, Film, HardDrive, Plus, Scissors, Sparkles } from "lucide-react";
import Link from "next/link";
import { ProjectCard } from "@/components/project-card";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import type { DashboardStats } from "@/lib/db-types";
import { formatBytes } from "@/lib/format";
import { listProjects } from "@/lib/server/projects";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  const supabase = await createClient();
  const [{ data: statsData }, projects, params] = await Promise.all([supabase.rpc("dashboard_stats"), listProjects(supabase, 6), searchParams]);
  const stats = (statsData ?? {}) as Partial<DashboardStats>;

  const cards = [
    { label: "Vídeos processados", value: stats.videos_processed ?? 0, sub: `${stats.minutes_processed ?? 0} min de conteúdo`, icon: Film },
    { label: "Cortes gerados", value: stats.clips_total ?? 0, sub: `${stats.projects ?? 0} projetos`, icon: Scissors },
    { label: "Cortes aprovados", value: stats.clips_approved ?? 0, sub: "prontos para publicar", icon: CheckCircle2 },
    { label: "Cortes pendentes", value: stats.clips_pending ?? 0, sub: "aguardando revisão", icon: Clock },
    { label: "Armazenamento", value: formatBytes(stats.storage_bytes ?? 0), sub: "vídeos + cortes", icon: HardDrive },
  ];

  return (
    <div className="space-y-10">
      {params.senha === "atualizada" && (
        <p className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-green-300">Senha atualizada com sucesso.</p>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Envie um vídeo longo e receba cortes prontos para publicar.</p>
        </div>
        <ButtonLink href="/projects/new" size="lg">
          <Plus className="size-4" /> Novo projeto
        </ButtonLink>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs">{label}</span>
              <Icon className="size-4" />
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
            <p className="mt-0.5 text-xs text-subtle">{sub}</p>
          </Card>
        ))}
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projetos recentes</h2>
          {projects.length > 0 && (
            <Link href="/projects" className="text-sm text-violet-300 hover:underline">
              Ver todos
            </Link>
          )}
        </div>
        {projects.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Nenhum projeto ainda"
            description="Envie seu primeiro vídeo (podcast, aula, live, entrevista) e a IA encontra os melhores momentos para você."
            action={
              <ButtonLink href="/projects/new">
                <Plus className="size-4" /> Criar primeiro projeto
              </ButtonLink>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
