"use client";

import { AlertTriangle, ArrowLeft, Check, Download, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, cx, Input, Label, ScorePill, Textarea } from "@/components/ui";
import { groupCaptionLines, retimeLine } from "@/lib/captions/grouping";
import { resolveCaptionStyle } from "@/lib/captions/styles";
import { computeKeepSegments, remapWords, wordsInRange } from "@/lib/clips/timing";
import { BUCKETS, CLIP_STATUS_LABELS, OUTPUT_SIZES } from "@/lib/constants";
import type { ClipRow } from "@/lib/db-types";
import { formatDuration, formatTimestamp, parseTimestamp } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { AspectRatio, CaptionStyle, ClipFormat, Word } from "@/lib/types";
import { PreviewPlayer, type PlayerController } from "./preview-player";
import { StylePanel } from "./style-panel";
import { Timeline } from "./timeline";

type Tab = "cut" | "captions" | "text" | "format";

export function ClipEditor({
  initialClip,
  video,
  words,
  window: win,
  outputUrl: initialOutputUrl,
  clipCount,
}: {
  initialClip: ClipRow;
  video: { id: string; duration: number; width: number; height: number; sourceUrl: string | null; isProxy: boolean };
  words: Word[];
  window: { start: number; end: number };
  outputUrl: string | null;
  clipCount: number;
}) {
  const router = useRouter();
  const [clip, setClip] = useState(initialClip);
  const [tab, setTab] = useState<Tab>("cut");
  const [view, setView] = useState<"live" | "rendered">(initialOutputUrl ? "rendered" : "live");
  const [outputUrl, setOutputUrl] = useState(initialOutputUrl);

  // Estado editável
  const [start, setStart] = useState(Number(initialClip.start_time));
  const [end, setEnd] = useState(Number(initialClip.end_time));
  const [style, setStyle] = useState<CaptionStyle>(resolveCaptionStyle(initialClip.caption_style));
  const [format, setFormat] = useState<ClipFormat>(initialClip.format ?? { aspect: "9:16", layout: "fill" });
  const [removeSilences, setRemoveSilences] = useState(initialClip.remove_silences);
  const [showTitle, setShowTitle] = useState(initialClip.show_title);
  const [title, setTitle] = useState(initialClip.title);
  const [titleOnScreen, setTitleOnScreen] = useState(initialClip.title_on_screen ?? "");
  const [description, setDescription] = useState(initialClip.description);
  const [socialCaption, setSocialCaption] = useState(initialClip.social_caption);
  const [hashtags, setHashtags] = useState(initialClip.hashtags.join(" "));
  const [editedWords, setEditedWords] = useState<Word[] | null>(initialClip.caption_words);

  const [time, setTime] = useState(start);
  const [saving, setSaving] = useState<null | "save" | "render" | "approve" | "delete">(null);
  const [dirty, setDirty] = useState(false);
  const [needsRender, setNeedsRender] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const player = useRef<PlayerController | null>(null);

  const mark = useCallback((render = true) => {
    setDirty(true);
    if (render) setNeedsRender(true);
  }, []);

  // Palavras da legenda no timeline do ORIGINAL
  const captionSource = useMemo(() => editedWords ?? wordsInRange(words, start, end), [editedWords, words, start, end]);
  const segments = useMemo(
    () => (removeSilences ? computeKeepSegments(words, start, end) : [{ s: start, e: end }]),
    [removeSilences, words, start, end],
  );
  const outDuration = segments.reduce((a, s) => a + (s.e - s.s), 0);
  // Linhas no timeline de SAÍDA — idêntico ao que o renderizador gera
  const outLines = useMemo(
    () => groupCaptionLines(remapWords(captionSource, segments), style, style.highlightKeywords ? clip.keywords : []),
    [captionSource, segments, style, clip.keywords],
  );
  // Linhas no timeline do original (para edição de texto)
  const editLines = useMemo(() => groupCaptionLines(captionSource, style), [captionSource, style]);

  const setRange = (s: number, e: number) => {
    const ns = Math.max(0, Math.min(s, video.duration - 1));
    const ne = Math.min(video.duration || e, Math.max(e, ns + 1));
    setStart(Math.round(ns * 10) / 10);
    setEnd(Math.round(ne * 10) / 10);
    if (editedWords) {
      setEditedWords(null);
      setNotice("O intervalo mudou: as edições manuais da legenda foram descartadas e a transcrição original foi restaurada.");
    }
    mark();
  };

  function editLine(i: number, text: string) {
    const line = editLines[i];
    const first = line.words[0].s;
    const last = line.words[line.words.length - 1].e;
    const replaced = retimeLine(text, first, last);
    const out: Word[] = [];
    let inserted = false;
    for (const w of captionSource) {
      if (w.s >= first - 1e-6 && w.e <= last + 1e-6) {
        if (!inserted) {
          out.push(...replaced);
          inserted = true;
        }
      } else out.push(w);
    }
    setEditedWords(out);
    mark();
  }

  const payload = () => ({
    start_time: start,
    end_time: end,
    caption_style: style,
    format,
    remove_silences: removeSilences,
    show_title: showTitle,
    title: title.trim(),
    title_on_screen: titleOnScreen.trim(),
    description: description.trim(),
    social_caption: socialCaption.trim(),
    hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
    ...(editedWords ? { caption_words: editedWords } : {}),
  });

  async function request(url: string, init: RequestInit) {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Falha na operação");
    return data;
  }

  async function save(render: boolean) {
    setSaving(render ? "render" : "save");
    setError(null);
    try {
      const updated = (await request(`/api/clips/${clip.id}`, { method: "PATCH", body: JSON.stringify(payload()) })) as ClipRow;
      setClip(updated);
      setDirty(false);
      if (render) {
        await request(`/api/clips/${clip.id}/render`, { method: "POST" });
        setClip((c) => ({ ...c, status: "queued" }));
        setNeedsRender(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function approve() {
    setSaving("approve");
    try {
      const updated = (await request(`/api/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ approved: clip.status !== "approved" }),
      })) as ClipRow;
      setClip(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (!confirm("Excluir este corte?")) return;
    setSaving("delete");
    try {
      await request(`/api/clips/${clip.id}`, { method: "DELETE" });
      router.push(`/projects/${clip.project_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(null);
    }
  }

  // Acompanha a renderização
  const rendering = clip.status === "queued" || clip.status === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const supabase = createClient();
    const t = setInterval(async () => {
      const { data } = await supabase.from("clips").select("*").eq("id", clip.id).maybeSingle();
      if (!data) return;
      const c = data as ClipRow;
      setClip(c);
      if (c.output_path && c.status === "ready") {
        const { data: signed } = await supabase.storage.from(BUCKETS.clips).createSignedUrl(c.output_path, 6 * 3600);
        if (signed) {
          setOutputUrl(signed.signedUrl);
          setView("rendered");
        }
      }
    }, 2500);
    return () => clearInterval(t);
  }, [rendering, clip.id]);

  // Aviso ao sair com alterações não salvas
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const tabs: [Tab, string][] = [
    ["cut", "Corte"],
    ["captions", "Legenda"],
    ["text", "Título e texto"],
    ["format", "Formato"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/projects/${clip.project_id}`} className="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-muted hover:text-fg" aria-label="Voltar">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs text-muted">
              Corte #{String(clip.rank).padStart(2, "0")} de {clipCount}
            </p>
            <h1 className="truncate text-lg font-semibold">{title || "Sem título"}</h1>
          </div>
          <ScorePill score={clip.score} />
          <Badge tone={clip.status === "approved" ? "success" : rendering ? "brand" : clip.status === "failed" ? "danger" : "neutral"}>
            {rendering && <Loader2 className="size-3 animate-spin" />}
            {CLIP_STATUS_LABELS[clip.status]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={remove} loading={saving === "delete"} title="Excluir corte">
            <Trash2 className="size-4" />
          </Button>
          {clip.output_path && !rendering && (
            <a href={`/api/clips/${clip.id}/download`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-sm hover:bg-surface-3">
              <Download className="size-4" /> Baixar
            </a>
          )}
          {(clip.status === "ready" || clip.status === "approved") && (
            <Button variant="secondary" onClick={approve} loading={saving === "approve"}>
              <Check className="size-4" /> {clip.status === "approved" ? "Aprovado" : "Aprovar"}
            </Button>
          )}
          <Button variant="secondary" onClick={() => save(false)} disabled={!dirty} loading={saving === "save"}>
            <Save className="size-4" /> Salvar
          </Button>
          <Button onClick={() => save(true)} loading={saving === "render"} disabled={rendering}>
            <RefreshCw className="size-4" /> {needsRender || !clip.output_path ? "Salvar e gerar vídeo" : "Regenerar corte"}
          </Button>
        </div>
      </div>

      {error && <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {notice && (
        <p className="flex items-start justify-between gap-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-amber-200">
          {notice}
          <button onClick={() => setNotice(null)} className="text-amber-200/70 hover:text-amber-100">
            ok
          </button>
        </p>
      )}
      {clip.status === "failed" && clip.render_error && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Falha ao renderizar: {clip.render_error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Preview */}
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs">
              <button onClick={() => setView("live")} className={cx("rounded-lg px-3 py-1.5", view === "live" ? "bg-white/10" : "text-muted")}>
                Pré-visualização ao vivo
              </button>
              <button
                onClick={() => setView("rendered")}
                disabled={!outputUrl}
                className={cx("rounded-lg px-3 py-1.5 disabled:opacity-40", view === "rendered" ? "bg-white/10" : "text-muted")}
              >
                Vídeo final
              </button>
            </div>
            <span className="text-xs text-muted">
              {OUTPUT_SIZES[format.aspect].width}×{OUTPUT_SIZES[format.aspect].height} · {formatDuration(outDuration)}
            </span>
          </div>
          {view === "rendered" && outputUrl ? (
            <div className="flex justify-center">
              <video
                key={outputUrl}
                src={outputUrl}
                controls
                playsInline
                className="max-h-[70dvh] rounded-2xl bg-black ring-1 ring-line"
                style={{ aspectRatio: `${OUTPUT_SIZES[clip.format.aspect].width} / ${OUTPUT_SIZES[clip.format.aspect].height}` }}
              />
            </div>
          ) : (
            <PreviewPlayer
              src={video.sourceUrl}
              start={start}
              end={end}
              segments={segments}
              format={format}
              framing={clip.framing}
              source={{ width: video.width, height: video.height }}
              lines={outLines}
              style={style}
              title={titleOnScreen || title}
              showTitle={showTitle}
              controllerRef={player}
              onTime={setTime}
            />
          )}
          {view === "live" && (
            <p className="mt-4 text-center text-xs text-subtle">
              Prévia aproximada {video.isProxy ? "em baixa resolução" : ""}. {needsRender ? "Gere o vídeo para aplicar as alterações no arquivo final." : ""}
            </p>
          )}
          {rendering && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-violet-200">
              <Loader2 className="size-4 animate-spin" /> Gerando o vídeo do corte... ({clip.render_stage ?? "na fila"})
            </div>
          )}
        </Card>

        {/* Painel lateral */}
        <Card className="flex min-h-0 flex-col">
          <div className="flex border-b border-line px-2">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cx(
                  "-mb-px border-b-2 px-3 py-3 text-sm transition",
                  tab === k ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-[75dvh] space-y-5 overflow-y-auto p-5">
            {tab === "cut" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <TimeField key={`s-${start}`} label="Início" value={start} onChange={(v) => setRange(v, end)} onNow={() => setRange(time, end)} />
                  <TimeField key={`e-${end}`} label="Fim" value={end} onChange={(v) => setRange(start, v)} onNow={() => setRange(start, time)} />
                </div>
                <Timeline
                  windowStart={win.start}
                  windowEnd={win.end}
                  start={start}
                  end={end}
                  time={time}
                  words={words}
                  onChange={setRange}
                  onSeek={(t) => player.current?.seek(t)}
                />
                <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={removeSilences}
                    onChange={(e) => {
                      setRemoveSilences(e.target.checked);
                      mark();
                    }}
                  />
                  <span>
                    Remover pausas e silêncios
                    <span className="block text-xs text-muted">
                      {removeSilences ? `${segments.length} trecho(s) · ${formatDuration(end - start - outDuration)} de pausas removidas` : "O corte mantém o áudio contínuo."}
                    </span>
                  </span>
                </label>
                <div>
                  <Label hint="clique numa palavra para ir até ela">Transcrição</Label>
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-surface-2 p-3 text-sm leading-7">
                    {words.map((w, i) => {
                      const inside = w.e > start && w.s < end;
                      const active = time >= w.s && time < w.e;
                      return (
                        <span key={i}>
                          <button
                            onClick={() => player.current?.seek(w.s)}
                            onDoubleClick={() => (w.s < start ? setRange(w.s, end) : setRange(start, w.e))}
                            className={cx(
                              "rounded px-0.5 transition",
                              active ? "bg-brand text-white" : inside ? "text-fg hover:bg-white/10" : "text-subtle hover:bg-white/5",
                            )}
                            title="Clique: ir · Duplo clique: estender o corte até aqui"
                          >
                            {w.w}
                          </button>{" "}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] text-subtle">Duplo clique numa palavra fora do corte estende o início/fim até ela.</p>
                </div>
              </>
            )}

            {tab === "captions" && (
              <>
                <StylePanel
                  style={style}
                  onChange={(s) => {
                    setStyle(s);
                    mark();
                  }}
                />
                <div>
                  <Label hint={editedWords ? "editada" : "original"}>Texto da legenda</Label>
                  <div className="space-y-1.5">
                    {editLines.map((l, i) => (
                      <div key={`${i}-${l.start}`} className="flex items-center gap-2">
                        <button onClick={() => player.current?.seek(l.start)} className="w-14 shrink-0 text-left text-[11px] tabular-nums text-subtle hover:text-fg">
                          {formatTimestamp(l.start)}
                        </button>
                        <Input
                          defaultValue={l.words.map((w) => w.w).join(" ")}
                          onBlur={(e) => {
                            const original = l.words.map((w) => w.w).join(" ");
                            if (e.target.value.trim() && e.target.value.trim() !== original) editLine(i, e.target.value);
                          }}
                          className="h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  {editedWords && (
                    <button
                      onClick={() => {
                        setEditedWords(null);
                        mark();
                      }}
                      className="mt-2 text-xs text-violet-300 hover:underline"
                    >
                      Restaurar transcrição original
                    </button>
                  )}
                </div>
              </>
            )}

            {tab === "text" && (
              <>
                <div>
                  <Label hint={`${title.length}/140`}>Título</Label>
                  <Input
                    value={title}
                    maxLength={140}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      mark(false);
                    }}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">Título na tela</span>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={showTitle}
                        onChange={(e) => {
                          setShowTitle(e.target.checked);
                          mark();
                        }}
                      />
                      Mostrar nos primeiros segundos
                    </label>
                  </div>
                  <Input
                    value={titleOnScreen}
                    maxLength={80}
                    placeholder={title}
                    onChange={(e) => {
                      setTitleOnScreen(e.target.value);
                      mark();
                    }}
                  />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea
                    rows={3}
                    value={description}
                    maxLength={1000}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      mark(false);
                    }}
                  />
                </div>
                <div>
                  <Label>Legenda do post</Label>
                  <Textarea
                    rows={5}
                    value={socialCaption}
                    maxLength={2200}
                    onChange={(e) => {
                      setSocialCaption(e.target.value);
                      mark(false);
                    }}
                  />
                </div>
                <div>
                  <Label>Hashtags</Label>
                  <Input
                    value={hashtags}
                    onChange={(e) => {
                      setHashtags(e.target.value);
                      mark(false);
                    }}
                  />
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
                  <p className="font-medium text-fg">Gancho</p>
                  <p className="mt-1">“{clip.hook}”</p>
                  <p className="mt-3 font-medium text-fg">Por que este trecho</p>
                  <p className="mt-1">{clip.reason}</p>
                </div>
              </>
            )}

            {tab === "format" && (
              <>
                <div>
                  <Label>Proporção</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(OUTPUT_SIZES) as AspectRatio[]).map((a) => (
                      <button
                        key={a}
                        onClick={() => {
                          setFormat((f) => ({ ...f, aspect: a }));
                          mark();
                        }}
                        className={cx(
                          "rounded-xl border px-3 py-2.5 text-left text-xs transition",
                          format.aspect === a ? "border-brand/60 bg-brand/10" : "border-line bg-surface-2 text-muted hover:text-fg",
                        )}
                      >
                        <span className="block text-sm font-semibold text-fg">{a}</span>
                        {OUTPUT_SIZES[a].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Enquadramento</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["fill", "Preencher", "Recorta e acompanha o rosto principal."],
                        ["fit", "Inteiro", "Vídeo inteiro sobre fundo desfocado."],
                      ] as const
                    ).map(([k, label, desc]) => (
                      <button
                        key={k}
                        onClick={() => {
                          setFormat((f) => ({ ...f, layout: k }));
                          mark();
                        }}
                        className={cx(
                          "rounded-xl border px-3 py-2.5 text-left text-xs transition",
                          format.layout === k ? "border-brand/60 bg-brand/10" : "border-line bg-surface-2 text-muted hover:text-fg",
                        )}
                      >
                        <span className="block text-sm font-semibold text-fg">{label}</span>
                        {desc}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-subtle">
                  Saída: MP4 · H.264 · AAC · {OUTPUT_SIZES[format.aspect].width}×{OUTPUT_SIZES[format.aspect].height}. Compatível com Instagram Reels, TikTok e YouTube
                  Shorts.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function TimeField({ label, value, onChange, onNow }: { label: string; value: number; onChange: (v: number) => void; onNow: () => void }) {
  const [text, setText] = useState(formatTimestamp(value));
  const commit = () => {
    const v = parseTimestamp(text);
    if (v != null) onChange(v);
    else setText(formatTimestamp(value));
  };
  return (
    <div>
      <Label hint={<button onClick={onNow} className="text-violet-300 hover:underline">usar posição atual</button>}>{label}</Label>
      <div className="flex gap-1">
        <button onClick={() => onChange(value - 0.5)} className="h-10 w-9 shrink-0 rounded-xl border border-line bg-surface-2 text-muted hover:text-fg" aria-label="-0,5s">
          −
        </button>
        <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="text-center tabular-nums" />
        <button onClick={() => onChange(value + 0.5)} className="h-10 w-9 shrink-0 rounded-xl border border-line bg-surface-2 text-muted hover:text-fg" aria-label="+0,5s">
          +
        </button>
      </div>
    </div>
  );
}
