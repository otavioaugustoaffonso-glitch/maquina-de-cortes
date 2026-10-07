"use client";

import { AlertTriangle, Check, Download, Loader2, Pencil, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { Badge, cx, ScorePill } from "@/components/ui";
import { CLIP_STATUS_LABELS } from "@/lib/constants";
import type { ClipRow } from "@/lib/db-types";
import { formatDuration } from "@/lib/format";

const STAGE_LABELS: Record<string, string> = {
  preparing: "Preparando...",
  framing: "Enquadrando rosto...",
  captions: "Adicionando legendas...",
  encoding: "Gerando vídeo...",
  uploading: "Finalizando...",
};

export function ClipCard({
  clip,
  thumbUrl,
  videoUrl,
  onOpen,
  onApprove,
  onDelete,
  onRender,
}: {
  clip: ClipRow;
  thumbUrl?: string;
  videoUrl?: string;
  onOpen: () => void;
  onApprove: (approved: boolean) => void;
  onDelete: () => void;
  onRender: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = clip.output_duration_seconds ?? clip.end_time - clip.start_time;
  const busy = clip.status === "queued" || clip.status === "rendering";
  const rendered = clip.status === "ready" || clip.status === "approved";

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-line-strong">
      <button
        className="relative aspect-[9/16] w-full overflow-hidden bg-surface-2"
        onClick={onOpen}
        onMouseEnter={() => videoRef.current?.play().catch(() => {})}
        onMouseLeave={() => {
          if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
          }
        }}
        aria-label={`Abrir corte ${clip.rank}`}
      >
        {thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        {videoUrl && rendered && (
          <video
            ref={videoRef}
            src={videoUrl}
            muted
            playsInline
            loop
            preload="none"
            className="absolute inset-0 size-full object-cover opacity-0 transition group-hover:opacity-100"
          />
        )}
        {!thumbUrl && (
          <div className="absolute inset-0 grid place-items-center">
            {busy ? (
              <div className="flex flex-col items-center gap-2 text-muted">
                <Loader2 className="size-6 animate-spin text-violet-300" />
                <span className="text-xs">{clip.status === "rendering" ? (STAGE_LABELS[clip.render_stage ?? ""] ?? "Renderizando...") : "Na fila..."}</span>
              </div>
            ) : clip.status === "failed" ? (
              <AlertTriangle className="size-6 text-red-400" />
            ) : (
              <Wand2 className="size-6 text-subtle" />
            )}
          </div>
        )}
        {thumbUrl && busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <Loader2 className="size-6 animate-spin text-violet-300" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-2.5">
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">#{String(clip.rank).padStart(2, "0")}</span>
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white backdrop-blur">{formatDuration(duration)}</span>
        </div>
</button>

      <div className="flex flex-1 flex-col p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <ScorePill score={clip.score} />
          <Badge tone={clip.status === "approved" ? "success" : clip.status === "failed" ? "danger" : busy ? "brand" : "neutral"}>
            {CLIP_STATUS_LABELS[clip.status]}
          </Badge>
        </div>
        <h3 className="line-clamp-2 text-sm font-medium leading-snug" title={clip.title}>
          {clip.title}
        </h3>
        {clip.retention_potential && <p className="mt-1 text-[11px] text-subtle">Retenção: {clip.retention_potential}</p>}

        <div className="mt-auto flex items-center gap-1 pt-3">
          {rendered ? (
            <button
              onClick={() => onApprove(clip.status !== "approved")}
              className={cx(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition",
                clip.status === "approved" ? "bg-success/15 text-green-300 hover:bg-success/25" : "bg-white/5 text-fg hover:bg-white/10",
              )}
            >
              <Check className="size-3.5" />
              {clip.status === "approved" ? "Aprovado" : "Aprovar"}
            </button>
          ) : clip.status === "suggested" || clip.status === "failed" ? (
            <button onClick={onRender} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand/15 text-xs font-medium text-violet-200 hover:bg-brand/25">
              <Wand2 className="size-3.5" /> {clip.status === "failed" ? "Tentar de novo" : "Gerar vídeo"}
            </button>
          ) : (
            <div className="flex-1" />
          )}
          <Link href={`/projects/${clip.project_id}/clips/${clip.id}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg" title="Editar">
            <Pencil className="size-3.5" />
          </Link>
          {rendered && (
            <a href={`/api/clips/${clip.id}/download`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg" title="Baixar">
              <Download className="size-3.5" />
            </a>
          )}
          <button onClick={onDelete} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-red-300" title="Excluir">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
