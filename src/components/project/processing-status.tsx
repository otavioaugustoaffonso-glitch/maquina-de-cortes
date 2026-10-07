import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Card, cx, ProgressBar } from "@/components/ui";
import { PROCESSING_STEPS, STATUS_LABELS, stepIndex } from "@/lib/constants";
import type { VideoRow } from "@/lib/db-types";

export function ProcessingStatus({ video, rendering }: { video: VideoRow; rendering: { done: number; total: number } }) {
  if (video.status === "failed") {
    return (
      <Card className="border-danger/30 bg-danger/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 text-red-400" />
          <div>
            <p className="font-medium text-red-200">O processamento falhou</p>
            <p className="mt-1 text-sm text-red-300/80">{video.error ?? "Erro desconhecido."}</p>
          </div>
        </div>
      </Card>
    );
  }
  const current = stepIndex(video.status);
  return (
    <Card className="overflow-hidden p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-violet-300" />
          <div>
            <p className="font-medium">{STATUS_LABELS[video.status]}</p>
            <p className="text-xs text-muted">
              {video.status === "generating_clips" || video.status === "adding_captions"
                ? `${rendering.done} de ${rendering.total} cortes prontos`
                : "Você pode sair desta página — o processamento continua em segundo plano."}
            </p>
          </div>
        </div>
        <span className="text-sm tabular-nums text-muted">{video.progress}%</span>
      </div>
      <ProgressBar value={video.progress} />
      <ol className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-8">
        {PROCESSING_STEPS.slice(0, 8).map((s, i) => (
          <li key={s.status} className={cx("flex items-center gap-1.5", i < current ? "text-muted" : i === current ? "text-fg" : "text-subtle/60")}>
            {i < current ? (
              <Check className="size-3.5 shrink-0 text-success" />
            ) : i === current ? (
              <span className="relative flex size-2.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
              </span>
            ) : (
              <span className="size-2.5 shrink-0 rounded-full border border-line-strong" />
            )}
            <span className="truncate">{s.label.replace("...", "")}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
