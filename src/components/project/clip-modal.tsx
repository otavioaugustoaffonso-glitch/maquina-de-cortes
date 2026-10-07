"use client";

import { Check, Copy, Download, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, ButtonLink, ScorePill } from "@/components/ui";
import type { ClipRow } from "@/lib/db-types";
import { formatDuration, formatTimestamp } from "@/lib/format";

const FACTORS: { key: "hook" | "clarity" | "value" | "emotion" | "curiosity" | "standalone" | "flow"; label: string }[] = [
  { key: "hook", label: "Gancho" },
  { key: "standalone", label: "Funciona sozinho" },
  { key: "value", label: "Valor" },
  { key: "clarity", label: "Clareza" },
  { key: "emotion", label: "Emoção" },
  { key: "curiosity", label: "Curiosidade" },
  { key: "flow", label: "Fluidez da fala" },
];

export function ClipModal({
  clip,
  videoUrl,
  onClose,
  onApprove,
}: {
  clip: ClipRow;
  videoUrl?: string;
  onClose: () => void;
  onApprove: (approved: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const rendered = clip.status === "ready" || clip.status === "approved";
  const caption = `${clip.social_caption}\n\n${clip.hashtags.join(" ")}`.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative grid max-h-[92dvh] w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl md:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex items-center justify-center bg-black">
          {rendered && videoUrl ? (
            <video src={videoUrl} controls autoPlay playsInline className="max-h-[92dvh] w-full object-contain" />
          ) : (
            <p className="p-10 text-center text-sm text-muted">O vídeo deste corte ainda não foi gerado.</p>
          )}
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-muted">
                Corte #{String(clip.rank).padStart(2, "0")} · {formatTimestamp(clip.start_time)} → {formatTimestamp(clip.end_time)} ·{" "}
                {formatDuration(clip.output_duration_seconds ?? clip.end_time - clip.start_time)}
              </p>
              <h2 className="mt-1 text-lg font-semibold leading-snug">{clip.title}</h2>
            </div>
            <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Fechar">
              <X className="size-5" />
            </button>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <ScorePill score={clip.score} />
            {clip.retention_potential && <Badge tone="brand">Retenção: {clip.retention_potential}</Badge>}
            {clip.category && <Badge>{clip.category.replace("_", " ")}</Badge>}
          </div>

          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Gancho inicial</dt>
              <dd className="mt-1 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-violet-100">“{clip.hook}”</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Descrição</dt>
              <dd className="mt-1 text-muted">{clip.description}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Por que este trecho</dt>
              <dd className="mt-1 text-muted">{clip.reason}</dd>
            </div>
            {clip.keywords.length > 0 && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Palavras-chave</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {clip.keywords.map((k) => (
                    <Badge key={k}>{k}</Badge>
                  ))}
                </dd>
              </div>
            )}
            <div>
              <dt className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-subtle">
                Legenda sugerida
                <button
                  className="inline-flex items-center gap-1 normal-case text-violet-300 hover:underline"
                  onClick={() => {
                    void navigator.clipboard.writeText(caption);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copiado" : "Copiar"}
                </button>
              </dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-xl border border-line bg-surface-2 px-3 py-2 text-muted">{caption}</dd>
            </div>
            {clip.score_breakdown && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-subtle">Pontuação detalhada</dt>
                <dd className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2">
                  {FACTORS.map(({ key, label }) => {
                    const v = Number(clip.score_breakdown[key] ?? 0);
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs text-muted">
                          <span>{label}</span>
                          <span className="tabular-nums">{v.toFixed(1)}</span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-white/5">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${v * 10}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-5">
            {rendered && (
              <Button variant={clip.status === "approved" ? "secondary" : "primary"} onClick={() => onApprove(clip.status !== "approved")}>
                <Check className="size-4" /> {clip.status === "approved" ? "Remover aprovação" : "Aprovar"}
              </Button>
            )}
            <ButtonLink variant="secondary" href={`/projects/${clip.project_id}/clips/${clip.id}`}>
              <Pencil className="size-4" /> Editar
            </ButtonLink>
            {rendered && (
              <a href={`/api/clips/${clip.id}/download`} className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm text-muted hover:bg-white/5 hover:text-fg">
                <Download className="size-4" /> Baixar MP4
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
