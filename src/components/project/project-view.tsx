"use client";

import { Archive, Download, FileVideo, Loader2, Package, Scissors, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, EmptyState } from "@/components/ui";
import { BUCKETS, STATUS_LABELS } from "@/lib/constants";
import type { ClipRow, ExportRow, ProjectRow, VideoRow } from "@/lib/db-types";
import { formatBytes, formatDuration, formatRelativeDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { ClipCard } from "./clip-card";
import { ClipModal } from "./clip-modal";
import { ProcessingStatus } from "./processing-status";
import { useSignedUrls } from "./use-signed-urls";

type Filter = "all" | "pending" | "approved";

export function ProjectView({
  project,
  initialVideo,
  initialClips,
  initialExports,
}: {
  project: ProjectRow;
  initialVideo: VideoRow | null;
  initialClips: ClipRow[];
  initialExports: ExportRow[];
}) {
  const router = useRouter();
  const [video, setVideo] = useState(initialVideo);
  const [clips, setClips] = useState(initialClips);
  const [exportsList, setExports] = useState(initialExports);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processing = video && !["completed", "failed"].includes(video.status);
  const rendering = clips.some((c) => c.status === "queued" || c.status === "rendering");
  const exporting = exportsList.some((e) => e.status === "queued" || e.status === "processing");
  const active = processing || rendering || exporting;

  // Atualização em tempo quase real enquanto houver processamento
  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [v, c, e] = await Promise.all([
      video ? supabase.from("videos").select("*").eq("id", video.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("clips").select("*").eq("project_id", project.id).order("rank"),
      supabase.from("exports").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(5),
    ]);
    if (v.data) setVideo(v.data as VideoRow);
    if (c.data) setClips(c.data as ClipRow[]);
    if (e.data) setExports(e.data as ExportRow[]);
  }, [project.id, video]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const thumbs = useSignedUrls(BUCKETS.clips, clips.map((c) => c.thumbnail_path));
  const outputs = useSignedUrls(BUCKETS.clips, clips.map((c) => c.output_path));

  const visible = useMemo(
    () =>
      clips.filter((c) => (filter === "approved" ? c.status === "approved" : filter === "pending" ? c.status !== "approved" : true)),
    [clips, filter],
  );
  const counts = {
    all: clips.length,
    approved: clips.filter((c) => c.status === "approved").length,
    pending: clips.filter((c) => c.status !== "approved").length,
  };
  const readyIds = clips.filter((c) => c.status === "ready" || c.status === "approved").map((c) => c.id);
  const done = clips.filter((c) => ["ready", "approved", "failed"].includes(c.status)).length;
  const total = clips.filter((c) => c.status !== "suggested").length;

  async function api(url: string, init: RequestInit = {}) {
    setError(null);
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Algo deu errado");
      throw new Error(data.error);
    }
    return data;
  }

  async function approve(clip: ClipRow, approved: boolean) {
    setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, status: approved ? "approved" : "ready" } : c)));
    await api(`/api/clips/${clip.id}`, { method: "PATCH", body: JSON.stringify({ approved }) }).catch(() => refresh());
  }

  async function remove(clip: ClipRow) {
    if (!confirm(`Excluir o corte "${clip.title}"?`)) return;
    setClips((cs) => cs.filter((c) => c.id !== clip.id));
    await api(`/api/clips/${clip.id}`, { method: "DELETE" }).catch(() => refresh());
  }

  async function render(clip: ClipRow) {
    setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, status: "queued" } : c)));
    await api(`/api/clips/${clip.id}/render`, { method: "POST" }).catch(() => refresh());
  }

  async function exportZip(clipIds?: string[]) {
    setBusy("export");
    try {
      const exp = await api(`/api/projects/${project.id}/export`, { method: "POST", body: JSON.stringify({ clipIds }) });
      setExports((list) => [exp as ExportRow, ...list]);
    } catch {
      /* erro exibido */
    } finally {
      setBusy(null);
    }
  }

  async function deleteProject() {
    if (!confirm("Excluir este projeto, o vídeo original e todos os cortes? Esta ação não pode ser desfeita.")) return;
    setBusy("delete");
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      router.push("/dashboard");
      router.refresh();
    } catch {
      setBusy(null);
    }
  }

  const openClip = clips.find((c) => c.id === openId);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted">Projeto · criado {formatRelativeDate(project.created_at)}</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exportZip()} disabled={!counts.approved} loading={busy === "export"} title="Baixar cortes aprovados em .zip">
            <Package className="size-4" /> Baixar aprovados ({counts.approved})
          </Button>
          <Button variant="secondary" onClick={() => exportZip(readyIds)} disabled={!readyIds.length} loading={busy === "export"}>
            <Archive className="size-4" /> Baixar todos
          </Button>
          <Button variant="ghost" onClick={deleteProject} loading={busy === "delete"} title="Excluir projeto">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {error && <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {/* Vídeo original */}
      {video && (
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-violet-300">
              <FileVideo className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted">Vídeo original</p>
              <p className="truncate text-sm font-medium" title={video.original_filename}>
                {video.original_filename}
              </p>
            </div>
          </div>
          <Info label="Duração" value={formatDuration(video.duration_seconds)} />
          <Info label="Tamanho" value={formatBytes(video.size_bytes)} />
          {video.width && <Info label="Resolução" value={`${video.width}×${video.height}`} />}
          <div>
            <p className="text-xs text-muted">Status</p>
            <div className="mt-0.5">
              <Badge tone={video.status === "completed" ? "success" : video.status === "failed" ? "danger" : "brand"}>
                {processing && <Loader2 className="size-3 animate-spin" />}
                {STATUS_LABELS[video.status]}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {video && (processing || video.status === "failed") && <ProcessingStatus video={video} rendering={{ done, total }} />}
      {video?.status === "completed" && video.status_message && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-amber-200">{video.status_message}</p>
      )}

      {/* Exportações */}
      {exportsList.length > 0 && (
        <Card className="divide-y divide-line">
          {exportsList.slice(0, 3).map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <div className="flex items-center gap-3">
                <Archive className="size-4 text-muted" />
                <span>
                  Pacote com {e.clip_ids.length} corte(s) <span className="text-subtle">· {formatRelativeDate(e.created_at)}</span>
                </span>
              </div>
              {e.status === "ready" ? (
                <a href={`/api/exports/${e.id}/download`} className="inline-flex items-center gap-1.5 text-violet-300 hover:underline">
                  <Download className="size-4" /> Baixar .zip ({formatBytes(e.size_bytes)})
                </a>
              ) : e.status === "failed" ? (
                <Badge tone="danger">Falhou</Badge>
              ) : e.status === "expired" ? (
                <Badge>Expirado</Badge>
              ) : (
                <Badge tone="brand">
                  <Loader2 className="size-3 animate-spin" /> Preparando...
                </Badge>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Cortes */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Scissors className="size-4 text-violet-300" /> Cortes encontrados
          </h2>
          <div className="flex rounded-xl border border-line bg-surface p-1 text-xs">
            {(
              [
                ["all", "Todos"],
                ["pending", "Pendentes"],
                ["approved", "Aprovados"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={cx("rounded-lg px-3 py-1.5 transition", filter === k ? "bg-white/10 text-fg" : "text-muted hover:text-fg")}
              >
                {label} <span className="opacity-60">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        {clips.length === 0 ? (
          processing ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="shimmer aspect-[9/16] rounded-2xl border border-line bg-surface" />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Scissors className="size-5" />} title="Nenhum corte" description="Nenhum corte foi gerado para este projeto." />
          )
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                thumbUrl={c.thumbnail_path ? thumbs[c.thumbnail_path] : undefined}
                videoUrl={c.output_path ? outputs[c.output_path] : undefined}
                onOpen={() => setOpenId(c.id)}
                onApprove={(a) => approve(c, a)}
                onDelete={() => remove(c)}
                onRender={() => render(c)}
              />
            ))}
          </div>
        )}
      </section>

      {openClip && (
        <ClipModal
          clip={openClip}
          videoUrl={openClip.output_path ? outputs[openClip.output_path] : undefined}
          onClose={() => setOpenId(null)}
          onApprove={(a) => approve(openClip, a)}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
