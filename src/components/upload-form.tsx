"use client";

import { CloudUpload, FileVideo, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { Button, Card, cx, Input, Label, ProgressBar } from "@/components/ui";
import { CAPTION_PRESETS } from "@/lib/captions/styles";
import { ACCEPTED_EXTENSIONS, OUTPUT_SIZES, resolveVideoMime, TUS_CHUNK_SIZE } from "@/lib/constants";
import { formatBytes, formatDuration } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { AspectRatio, CaptionPresetId, Layout } from "@/lib/types";

type Phase = "idle" | "uploading" | "finishing" | "error";

/** Lê a duração no navegador (não funciona para todos os codecs — ex.: alguns MKV). */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

export function UploadForm({ maxBytes, defaultPreset }: { maxBytes: number; defaultPreset?: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("auto");
  const [preset, setPreset] = useState<CaptionPresetId>(defaultPreset && defaultPreset in CAPTION_PRESETS ? (defaultPreset as CaptionPresetId) : "highlight");
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [layout, setLayout] = useState<Layout>("fill");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef<tus.Upload | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const rejectRef = useRef<((e: Error) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback(
    async (f: File | undefined) => {
      if (!f) return;
      setError(null);
      if (!resolveVideoMime(f.name, f.type)) {
        setError("Formato não suportado. Envie MP4, MOV, WEBM ou MKV.");
        return;
      }
      if (f.size > maxBytes) {
        setError(`Arquivo muito grande (${formatBytes(f.size)}). Limite: ${formatBytes(maxBytes)}.`);
        return;
      }
      setFile(f);
      setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120));
      setDuration(null);
      setDuration(await readDuration(f));
    },
    [maxBytes],
  );

  // Avisa antes de fechar a aba durante o upload
  useEffect(() => {
    if (phase !== "uploading") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  async function start() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);
    cancelledRef.current = false;
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || file.name,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          durationSeconds: duration,
          settings: { language, captionPreset: preset, aspect, layout },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao iniciar o upload");
      videoIdRef.current = data.videoId;
      if (cancelledRef.current) {
        await fetch(`/api/videos/${data.videoId}`, { method: "DELETE" });
        return;
      }

      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      const startedAt = Date.now();
      // Upload resumable (TUS) direto para o Supabase Storage: suporta arquivos grandes,
      // retoma automaticamente após quedas de conexão e não passa pelo servidor Next.js.
      await new Promise<void>((resolve, reject) => {
        rejectRef.current = reject;
        const upload = new tus.Upload(file, {
          endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
          retryDelays: [0, 2000, 5000, 10000, 20000],
          headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: TUS_CHUNK_SIZE,
          metadata: { bucketName: data.bucket, objectName: data.objectPath, contentType: data.contentType, cacheControl: "3600" },
          onProgress(sent, total) {
            setProgress((sent / total) * 100);
            const secs = (Date.now() - startedAt) / 1000;
            if (secs > 1) setSpeed(sent / secs);
          },
          onError: (e) => reject(e),
          onSuccess: () => resolve(),
        });
        uploadRef.current = upload;
        upload.findPreviousUploads().then((prev) => {
          if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
          upload.start();
        });
      });

      setPhase("finishing");
      const done = await fetch(`/api/videos/${data.videoId}/complete`, { method: "POST" });
      if (!done.ok) throw new Error((await done.json()).error ?? "Falha ao finalizar o upload");
      router.push(`/projects/${data.projectId}`);
    } catch (e) {
      if (cancelledRef.current) return;
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function cancel() {
    cancelledRef.current = true;
    rejectRef.current?.(new Error("cancelado"));
    const upload = uploadRef.current;
    uploadRef.current = null;
    if (upload) await upload.abort(true).catch(() => {});
    if (videoIdRef.current) await fetch(`/api/videos/${videoIdRef.current}`, { method: "DELETE" }).catch(() => {});
    videoIdRef.current = null;
    setPhase("idle");
    setProgress(0);
    setSpeed(null);
  }

  const busy = phase === "uploading" || phase === "finishing";
  const eta = speed && file ? ((100 - progress) / 100) * (file.size / speed) : null;

  return (
    <div className="space-y-6">
      {!file ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void pick(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-20 text-center transition",
            dragging ? "border-brand bg-brand/10" : "border-line-strong bg-surface/60 hover:border-brand/50 hover:bg-surface",
          )}
        >
          <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand/30 to-brand-2/20 text-violet-200 shadow-lg shadow-brand/20 transition group-hover:scale-105">
            <CloudUpload className="size-7" />
          </div>
          <p className="text-lg font-medium">Arraste e solte seu vídeo aqui</p>
          <p className="mt-1 text-sm text-muted">ou clique para selecionar um arquivo</p>
          <p className="mt-4 text-xs text-subtle">
            MP4, MOV, WEBM ou MKV · até {formatBytes(maxBytes)}
          </p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={[...ACCEPTED_EXTENSIONS, "video/*"].join(",")}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>
      ) : (
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/15 text-violet-300">
              <FileVideo className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{file.name}</p>
              <p className="mt-0.5 text-sm text-muted">
                {formatBytes(file.size)} · {duration ? formatDuration(duration) : "duração calculada após o envio"}
              </p>
            </div>
            {!busy && (
              <button
                onClick={() => {
                  setFile(null);
                  setPhase("idle");
                  setError(null);
                }}
                className="text-muted hover:text-fg"
                aria-label="Remover arquivo"
              >
                <X className="size-5" />
              </button>
            )}
          </div>
          {busy && (
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs text-muted">
                <span>{phase === "finishing" ? "Finalizando envio..." : "Enviando vídeo..."}</span>
                <span className="tabular-nums">
                  {progress.toFixed(0)}%{speed ? ` · ${formatBytes(speed)}/s` : ""}
                  {eta && phase === "uploading" ? ` · ~${formatDuration(eta)} restantes` : ""}
                </span>
              </div>
              <ProgressBar value={progress} />
            </div>
          )}
        </Card>
      )}

      {error && <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {file && (
        <Card className="space-y-5 p-5">
          <div>
            <Label htmlFor="name">Nome do projeto</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={busy} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Idioma do vídeo</Label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={busy}
                className="h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-brand/60"
              >
                <option value="auto">Detectar automaticamente</option>
                <option value="pt">Português</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
              </select>
            </div>
            <div>
              <Label>Formato</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["fill", "fit"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    disabled={busy}
                    onClick={() => setLayout(l)}
                    className={cx(
                      "h-10 rounded-xl border text-sm transition",
                      layout === l ? "border-brand/60 bg-brand/10 text-fg" : "border-line bg-surface-2 text-muted hover:text-fg",
                    )}
                  >
                    {l === "fill" ? "Preencher (foco no rosto)" : "Inteiro + fundo desfocado"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label>Proporção</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(OUTPUT_SIZES) as AspectRatio[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={busy}
                  onClick={() => setAspect(a)}
                  className={cx(
                    "rounded-xl border px-3 py-2 text-left text-xs transition",
                    aspect === a ? "border-brand/60 bg-brand/10 text-fg" : "border-line bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  <span className="font-semibold">{a}</span> <span className="opacity-70">{OUTPUT_SIZES[a].label.replace(/^[^(]*/, "")}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Estilo de legenda padrão</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(Object.keys(CAPTION_PRESETS) as CaptionPresetId[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={busy}
                  onClick={() => setPreset(p)}
                  className={cx(
                    "rounded-xl border px-3 py-3 text-sm transition",
                    preset === p ? "border-brand/60 bg-brand/10 text-fg" : "border-line bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  {CAPTION_PRESETS[p].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-subtle">Você pode mudar o estilo de cada corte depois, no editor.</p>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            {busy ? (
              <Button variant="danger" onClick={cancel} disabled={phase === "finishing"}>
                Cancelar upload
              </Button>
            ) : (
              <Button size="lg" onClick={start}>
                <Sparkles className="size-4" /> {phase === "error" ? "Tentar novamente" : "Enviar e gerar cortes"}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
