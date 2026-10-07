import { AlertTriangle, Clapperboard, Scissors } from "lucide-react";
import Link from "next/link";
import { Badge, ProgressBar } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/constants";
import { formatDuration, formatRelativeDate } from "@/lib/format";
import type { ProjectSummary } from "@/lib/server/projects";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const v = project.video;
  const processing = v && !["completed", "failed"].includes(v.status);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:border-line-strong"
    >
      <div className="relative aspect-video overflow-hidden bg-surface-2">
        {project.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover opacity-80 blur-[1px] transition group-hover:opacity-100" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-subtle">
            <Clapperboard className="size-8" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
          {v?.status === "completed" ? (
            <Badge tone="success">Concluído</Badge>
          ) : v?.status === "failed" ? (
            <Badge tone="danger">
              <AlertTriangle className="size-3" /> Falhou
            </Badge>
          ) : v ? (
            <Badge tone="brand">{STATUS_LABELS[v.status]}</Badge>
          ) : (
            <Badge>Sem vídeo</Badge>
          )}
          {v?.duration_seconds ? <span className="text-xs tabular-nums text-white/80">{formatDuration(v.duration_seconds)}</span> : null}
        </div>
      </div>
      <div className="p-4">
        <h3 className="truncate font-medium">{project.name}</h3>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Scissors className="size-3" /> {project.clipCount} cortes
          </span>
          {project.approvedCount > 0 && <span>{project.approvedCount} aprovados</span>}
          <span className="ml-auto">{formatRelativeDate(project.created_at)}</span>
        </div>
        {processing && <ProgressBar value={v!.progress} className="mt-3" />}
      </div>
    </Link>
  );
}
