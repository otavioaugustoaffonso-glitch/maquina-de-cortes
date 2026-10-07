/**
 * Máquina de Cortes — edição navegador.
 * Fluxo: arquivo -> áudio 16 kHz -> Whisper (worker) -> escolha dos melhores
 * trechos (regras locais ou Claude, opcional) -> cortes 9:16 com legendas
 * gravados no próprio navegador -> download.
 * O vídeo nunca sai do aparelho do usuário (computador ou celular).
 */
import fixWebmDuration from "fix-webm-duration";
import JSZip from "jszip";
import { formatTranscriptForPrompt, splitTranscriptWindows } from "@/lib/ai/transcript";
import { groupCaptionLines, retimeLine } from "@/lib/captions/grouping";
import { CAPTION_PRESETS } from "@/lib/captions/styles";
import { finalizeCandidates, targetClipCount } from "@/lib/clips/candidates";
import { computeKeepSegments, remapWords, wordsInRange } from "@/lib/clips/timing";
import { formatDuration, slugify } from "@/lib/format";
import type { CaptionPresetId, ClipCandidate, Framing, RawClipCandidate, Segment, Word } from "@/lib/types";
import { HeuristicAnalyzer } from "../../worker/ai/analysis/heuristic";
import { buildUserPrompt, SYSTEM_PROMPT } from "../../worker/ai/analysis/prompt";
import { ClipSchema } from "../../worker/ai/analysis/schema";
import { detectFraming } from "./face";
import { pickMimeType, renderClip, type Aspect, type LayoutMode } from "./render";
import type { OutMsg } from "./worker";

// ---------------------------------------------------------------- tipos/estado
type Clip = ClipCandidate & {
  id: string;
  status: "pending" | "queued" | "rendering" | "done" | "error";
  progress: number;
  blob?: Blob;
  url?: string;
  poster?: string;
  error?: string;
  stage?: string;
  /** null = segue o rosto automaticamente */
  cropX: number | null;
  framing?: Framing;
  framingKey?: string;
  preset: CaptionPresetId;
  removeSilences: boolean;
  showTitle: boolean;
  open: boolean;
};

type Settings = { language: string; preset: CaptionPresetId; aspect: Aspect; layout: LayoutMode; useClaude: boolean; autoRender: number };

const LANGS: Record<string, string | null> = { pt: "portuguese", en: "english", es: "spanish", auto: null };
const MAX_FILE_BYTES = 2 * 1024 ** 3;

const state = {
  file: null as File | null,
  duration: 0,
  words: [] as Word[],
  segments: [] as Segment[],
  clips: [] as Clip[],
  phase: "idle" as "idle" | "working" | "done" | "error",
  step: 0,
  stepProgress: 0,
  message: "",
  notice: "",
  settings: loadSettings(),
};

function loadSettings(): Settings {
  const base: Settings = { language: "pt", preset: "highlight", aspect: "9:16", layout: "fill", useClaude: false, autoRender: 5 };
  try {
    const s = JSON.parse(localStorage.getItem("mc-settings") ?? "{}");
    return { ...base, ...s };
  } catch {
    return base;
  }
}
function saveSettings() {
  try {
    localStorage.setItem("mc-settings", JSON.stringify(state.settings));
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

// ---------------------------------------------------------------- capacidades
type DownloadsNs = { save(r: { filename: string; data: Blob }): Promise<unknown> };
type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string; truncated?: boolean }>) | null;
type ClaudeRuntime = { use(name: string): Promise<unknown> };
const claudeRt = (window as unknown as { claude?: ClaudeRuntime }).claude;
let downloads: DownloadsNs | null = null;
let sample: SampleFn = null;
void claudeRt?.use("downloads").then((d) => {
  downloads = (d as DownloadsNs | null) ?? null;
  renderResults();
});
void claudeRt?.use("sample").then((s) => {
  sample = (s as SampleFn) ?? null;
  renderSettings();
});

// ---------------------------------------------------------------- utilidades DOM
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2).replace(".", ",")} GB` : `${Math.round(n / 1e6)} MB`);

const STEPS = [
  "Lendo o vídeo",
  "Extraindo o áudio",
  "Preparando a transcrição",
  "Transcrevendo",
  "Encontrando os melhores momentos",
  "Gerando os cortes",
];

function setStep(step: number, progress = 0, message = "") {
  state.step = step;
  state.stepProgress = progress;
  if (message) state.message = message;
  renderProgress();
}

// ---------------------------------------------------------------- vídeo de trabalho
const video = document.createElement("video");
video.playsInline = true;
video.preload = "auto";
video.crossOrigin = "anonymous";
let audioCtx: AudioContext | null = null;
let audioDest: MediaStreamAudioDestinationNode | null = null;

function ensureAudioGraph() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaElementSource(video);
    audioDest = audioCtx.createMediaStreamDestination();
    src.connect(audioDest); // não conecta aos alto-falantes: a gravação é silenciosa
  }
  void audioCtx.resume();
}

function loadVideo(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      state.duration = video.duration;
      resolve();
    };
    video.onerror = () => reject(new Error("Seu navegador não conseguiu abrir este vídeo. Tente um arquivo MP4 (H.264)."));
    video.src = url;
  });
}

async function decodeAudio(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 16000, 16000);
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buf);
  } catch {
    throw new Error("Não consegui ler o áudio deste vídeo. Tente converter para MP4 (H.264 + AAC).");
  }
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / audio.numberOfChannels;
  }
  return out;
}

let worker: Worker | null = null;
function transcribe(audio: Float32Array, language: string | null): Promise<Extract<OutMsg, { type: "result" }>> {
  worker ??= new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<OutMsg>) => {
      const m = e.data;
      if (m.type === "status") {
        if (m.stage === "download") setStep(2, m.progress, "Baixando o modelo de transcrição (só na primeira vez, ~80 MB)...");
        else if (m.stage === "load") setStep(3, 0, "Transcrevendo a fala...");
        else setStep(3, m.progress, "Transcrevendo a fala...");
      } else if (m.type === "result") resolve(m);
      else reject(new Error(m.message));
    };
    worker!.onerror = (e) => reject(new Error(`Falha no transcritor: ${e.message}`));
    worker!.postMessage({ type: "transcribe", audio, language }, [audio.buffer]);
  });
}

/** Distribui as palavras de cada trecho transcrito ao longo do seu tempo. */
function wordsFromChunks(chunks: { text: string; timestamp: [number, number | null] }[]): { words: Word[]; segments: Segment[] } {
  const words: Word[] = [];
  const segments: Segment[] = [];
  for (const c of chunks) {
    const s = c.timestamp[0];
    const e = Math.max(s + 0.3, c.timestamp[1] ?? s + 3);
    segments.push({ s, e, t: c.text });
    words.push(...retimeLine(c.text, s + 0.05, e - 0.05));
  }
  return { words, segments };
}

// ---------------------------------------------------------------- escolha dos cortes
const JSON_FORMAT = `

Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, no formato:
{"clips":[{"start":12.4,"end":48.0,"title":"...","title_on_screen":"...","description":"...","hook":"...","reason":"...","category":"dica","keywords":["..."],"hashtags":["#..."],"social_caption":"...","scores":{"hook":8,"clarity":7,"value":8,"emotion":6,"curiosity":7,"standalone":8}}]}`;

function parseClips(text: string): RawClipCandidate[] {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  try {
    const list = (JSON.parse(text.slice(a, b + 1)) as { clips?: unknown[] }).clips ?? [];
    return list.flatMap((item) => {
      const r = ClipSchema.safeParse({
        title_on_screen: "", description: "", hook: "", reason: "", category: "outro",
        keywords: [], hashtags: [], social_caption: "", ...(item as object),
      });
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

async function chooseWithClaude(segments: Segment[], duration: number): Promise<RawClipCandidate[]> {
  if (!sample) throw new Error("A IA do Claude não está disponível nesta visualização.");
  const windows = splitTranscriptWindows(segments, 120_000);
  const total = targetClipCount(duration);
  const all: RawClipCandidate[] = [];
  for (const [i, w] of windows.entries()) {
    const start = w[0].s;
    const end = w[w.length - 1].e;
    const share = (end - start) / duration;
    const prompt =
      SYSTEM_PROMPT +
      JSON_FORMAT +
      "\n\n" +
      buildUserPrompt({
        transcript: formatTranscriptForPrompt(w),
        durationSeconds: duration,
        language: state.settings.language === "auto" ? null : state.settings.language,
        clipCount: { min: Math.max(1, Math.round(total.min * share)), max: Math.max(2, Math.round(total.max * share)) },
        projectName: state.file?.name,
        window: windows.length > 1 ? { start, end, index: i, total: windows.length } : undefined,
      });
    const res = await sample(prompt, { modelTier: "default", cache: true });
    all.push(...parseClips(res.text));
    setStep(4, (i + 1) / windows.length, "A IA está escolhendo os melhores momentos...");
  }
  return all;
}

async function chooseClips(): Promise<ClipCandidate[]> {
  const transcript = formatTranscriptForPrompt(state.segments);
  let raw: RawClipCandidate[] = [];
  if (state.settings.useClaude && sample) {
    try {
      raw = await chooseWithClaude(state.segments, state.duration);
      if (!raw.length) throw new Error("resposta vazia");
    } catch (e) {
      const code = (e as { code?: string }).code;
      state.notice =
        code === "not_granted"
          ? "Você não autorizou o uso do Claude; os cortes foram escolhidos pelas regras automáticas."
          : "Não foi possível usar a IA do Claude agora; os cortes foram escolhidos pelas regras automáticas.";
      raw = [];
    }
  }
  if (!raw.length) {
    const r = await new HeuristicAnalyzer().analyze({
      transcript,
      durationSeconds: state.duration,
      language: null,
      clipCount: targetClipCount(state.duration),
    });
    raw = r.clips;
  }
  return finalizeCandidates(raw, state.words, state.duration, { maxClips: 15 });
}

// ---------------------------------------------------------------- renderização
let fontsLoaded: Promise<unknown> | null = null;
/** O canvas só usa fontes já carregadas: força o download das fontes das legendas. */
function loadCaptionFonts() {
  fontsLoaded ??= Promise.all(
    ['500 40px "Inter"', '800 40px "Inter"', '500 40px "Montserrat"', '800 40px "Montserrat"', '500 40px "Poppins"', '800 40px "Poppins"', '400 40px "Anton"', '400 40px "Bebas Neue"'].map((f) =>
      document.fonts.load(f).catch(() => null),
    ),
  );
  return fontsLoaded;
}
let renderQueue: Promise<void> = Promise.resolve();
const format = pickMimeType();

function enqueueRender(clip: Clip) {
  clip.status = "queued";
  clip.progress = 0;
  renderResults();
  renderQueue = renderQueue.then(() => doRender(clip));
  return renderQueue;
}

async function doRender(clip: Clip) {
  if (!format || !audioDest) {
    clip.status = "error";
    clip.error = "Seu navegador não consegue gravar vídeo. Use o Chrome, Edge ou Safari atualizados.";
    renderResults();
    return;
  }
  clip.status = "rendering";
  renderResults();
  try {
    const style = { ...CAPTION_PRESETS[clip.preset].style };
    const segments = clip.removeSilences ? computeKeepSegments(state.words, clip.start, clip.end) : [{ s: clip.start, e: clip.end }];
    const words = wordsInRange(state.words, clip.start, clip.end);
    const lines = groupCaptionLines(remapWords(words, segments), style, style.highlightKeywords ? clip.keywords : []);
    await loadCaptionFonts();
    // Enquadramento automático: só quando o vídeo é recortado e não há posição manual
    const needsFace = state.settings.layout === "fill" && clip.cropX === null && video.videoWidth / video.videoHeight > 0.8;
    const key = `${clip.start}-${clip.end}-${clip.removeSilences}`;
    if (needsFace && clip.framingKey !== key) {
      clip.stage = "Enquadrando o rosto...";
      renderResults();
      clip.framing = await detectFraming(video, segments, (f) => {
        clip.progress = f;
        updateClipProgress(clip);
      });
      clip.framingKey = key;
    }
    clip.stage = "Gravando...";
    clip.progress = 0;
    renderResults();
    const { blob: rawBlob, poster } = await renderClip({
      video,
      audioDest,
      segments,
      lines,
      style,
      title: clip.showTitle ? clip.title_on_screen || clip.title : "",
      aspect: state.settings.aspect,
      layout: state.settings.layout,
      cropX: clip.cropX,
      framing: needsFace ? (clip.framing ?? null) : null,
      format,
      onProgress: (f) => {
        clip.progress = f;
        updateClipProgress(clip);
      },
    });
    // WebM gravado pelo navegador não traz a duração no arquivo; corrige para os players
    const outDuration = segments.reduce((a, sg) => a + (sg.e - sg.s), 0);
    const blob = format.ext === "webm" ? await fixWebmDuration(rawBlob, outDuration * 1000, { logger: false }) : rawBlob;
    if (clip.url) URL.revokeObjectURL(clip.url);
    clip.blob = blob;
    clip.url = URL.createObjectURL(blob);
    clip.poster = poster;
    clip.status = "done";
  } catch (e) {
    clip.status = "error";
    clip.error = e instanceof Error ? e.message : String(e);
  }
  renderResults();
}

// ---------------------------------------------------------------- fluxo principal
async function start() {
  const file = state.file;
  if (!file) return;
  ensureAudioGraph(); // precisa acontecer no clique (política de áudio dos navegadores)
  state.phase = "working";
  const release = await keepScreenOn();
  state.clips = [];
  state.notice = "";
  renderAll();
  try {
    setStep(0, 0, "Abrindo o vídeo...");
    await loadVideo(file);
    setStep(1, 0, "Extraindo o áudio...");
    const audio = await decodeAudio(file);
    const res = await transcribe(audio, LANGS[state.settings.language] ?? null);
    const { words, segments } = wordsFromChunks(res.chunks);
    if (words.length < 20) throw new Error("Não encontrei fala suficiente neste vídeo para gerar cortes.");
    state.words = words;
    state.segments = segments;
    setStep(4, 0, state.settings.useClaude && sample ? "A IA está escolhendo os melhores momentos..." : "Encontrando os melhores momentos...");
    const chosen = await chooseClips();
    if (!chosen.length) throw new Error("Não encontrei trechos com potencial suficiente neste vídeo.");
    state.clips = chosen.map((c, i) => ({
      ...c,
      id: `c${i}-${Date.now()}`,
      status: "pending",
      progress: 0,
      cropX: null,
      preset: state.settings.preset,
      removeSilences: true,
      showTitle: true,
      open: false,
    }));
    setStep(5, 0, "Gerando os cortes (cada corte leva o tempo da sua duração)...");
    renderResults();
    const auto = state.clips.slice(0, state.settings.autoRender);
    for (const c of auto) void enqueueRender(c);
    await renderQueue;
    state.phase = "done";
  } catch (e) {
    state.phase = "error";
    state.message = e instanceof Error ? e.message : String(e);
  }
  release();
  renderAll();
}

/** Evita que a tela do celular apague no meio do processamento (a gravação pausa com a página oculta). */
async function keepScreenOn(): Promise<() => void> {
  type Lock = { release(): Promise<void> };
  const wl = (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<Lock> } }).wakeLock;
  if (!wl) return () => {};
  let lock: Lock | null = null;
  const acquire = () => wl.request("screen").then((l) => (lock = l)).catch(() => {});
  const onVisible = () => document.visibilityState === "visible" && state.phase === "working" && void acquire();
  await acquire();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release().catch(() => {});
  };
}

// ---------------------------------------------------------------- downloads
async function saveBlob(name: string, data: Blob) {
  if (!downloads) {
    state.notice = "O download não está disponível nesta visualização. Abra o artefato no claude.ai.";
    renderAll();
    return;
  }
  try {
    await downloads.save({ filename: name, data });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "declined") {
      state.notice = code === "rejected_extension" ? "Este formato de arquivo não pode ser baixado aqui." : "Não foi possível baixar o arquivo.";
      renderAll();
    }
  }
}
const fileName = (c: Clip) => `${String(c.rank).padStart(2, "0")}-${slugify(c.title)}.${format?.ext ?? "mp4"}`;

async function downloadAll() {
  const ready = state.clips.filter((c) => c.blob);
  if (!ready.length) return;
  const zip = new JSZip();
  const notes: string[] = [];
  for (const c of ready) {
    zip.file(fileName(c), c.blob!);
    notes.push(
      `#${String(c.rank).padStart(2, "0")} — ${c.title}\nPotencial: ${c.score}/100 · ${formatDuration(c.end - c.start)}\n${c.description}\n\nLegenda sugerida:\n${c.social_caption}\n${c.hashtags.join(" ")}`,
    );
  }
  zip.file("legendas-e-hashtags.txt", notes.join("\n\n----------------------------------------\n\n"));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  await saveBlob("cortes.zip", blob);
}

// ---------------------------------------------------------------- interface
function renderSettings() {
  const s = state.settings;
  const presets = (Object.keys(CAPTION_PRESETS) as CaptionPresetId[])
    .map(
      (p) =>
        `<button type="button" class="chip ${s.preset === p ? "on" : ""}" data-preset="${p}" aria-pressed="${s.preset === p}">${esc(CAPTION_PRESETS[p].label)}</button>`,
    )
    .join("");
  $("#settings").innerHTML = `
    <div class="field"><label for="lang">Idioma do vídeo</label>
      <select id="lang">
        <option value="pt" ${s.language === "pt" ? "selected" : ""}>Português</option>
        <option value="en" ${s.language === "en" ? "selected" : ""}>Inglês</option>
        <option value="es" ${s.language === "es" ? "selected" : ""}>Espanhol</option>
        <option value="auto" ${s.language === "auto" ? "selected" : ""}>Detectar</option>
      </select></div>
    <div class="field"><label for="aspect">Formato</label>
      <select id="aspect">
        <option value="9:16" ${s.aspect === "9:16" ? "selected" : ""}>Vertical 9:16 (Reels, TikTok, Shorts)</option>
        <option value="4:5" ${s.aspect === "4:5" ? "selected" : ""}>Retrato 4:5 (feed)</option>
        <option value="1:1" ${s.aspect === "1:1" ? "selected" : ""}>Quadrado 1:1</option>
      </select></div>
    <div class="field"><label for="layout">Enquadramento</label>
      <select id="layout">
        <option value="fill" ${s.layout === "fill" ? "selected" : ""}>Preencher a tela (recorta as laterais)</option>
        <option value="fit" ${s.layout === "fit" ? "selected" : ""}>Vídeo inteiro com fundo desfocado</option>
      </select></div>
    <div class="field"><label for="auto">Cortes gerados automaticamente</label>
      <select id="auto">${[3, 5, 8, 12].map((n) => `<option value="${n}" ${s.autoRender === n ? "selected" : ""}>${n} melhores</option>`).join("")}</select></div>
    <div class="field wide"><span class="lbl">Estilo da legenda</span><div class="chips">${presets}</div></div>
    ${
      sample
        ? `<label class="field wide toggle"><input type="checkbox" id="claude" ${s.useClaude ? "checked" : ""}>
             <span><strong>Usar a IA do Claude para escolher os cortes</strong><br>
             <small>Melhores títulos e ganchos. Envia só o texto da transcrição e usa o seu plano Claude (sem cobrança extra no plano; pode contar no seu limite de uso). Desligado = regras automáticas, tudo no seu aparelho.</small></span></label>`
        : ""
    }`;
  const bind = (id: string, key: keyof Settings, num = false) =>
    $(id).addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      (state.settings as Record<string, unknown>)[key] = num ? Number(v) : v;
      saveSettings();
    });
  bind("#lang", "language");
  bind("#aspect", "aspect");
  bind("#layout", "layout");
  bind("#auto", "autoRender", true);
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.preset = b.dataset.preset as CaptionPresetId;
      saveSettings();
      renderSettings();
    }),
  );
  document.querySelector<HTMLInputElement>("#claude")?.addEventListener("change", (e) => {
    state.settings.useClaude = (e.target as HTMLInputElement).checked;
    saveSettings();
  });
}

const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

function renderDrop() {
  const f = state.file;
  const busy = state.phase === "working";
  $("#drop-file").innerHTML = f
    ? `<strong>${esc(f.name)}</strong><span>${fmtBytes(f.size)}${state.duration ? ` · ${formatDuration(state.duration)}` : ""}</span>`
    : `<strong>Escolha o vídeo</strong><span>${
        TOUCH ? "Toque no botão e pegue o vídeo da Galeria ou dos Arquivos do celular" : "Clique no botão ou arraste o vídeo para cá"
      } · MP4, MOV, WEBM · até 2 GB</span>`;
  const pick = $("#pick");
  pick.textContent = f ? "Escolher outro vídeo" : TOUCH ? "Escolher vídeo do celular" : "Escolher vídeo dos arquivos";
  pick.classList.toggle("disabled", busy);
  $<HTMLInputElement>("#file").disabled = busy;
  const go = $<HTMLButtonElement>("#go");
  go.disabled = !f || busy;
  go.textContent = busy ? "Processando..." : state.phase === "done" ? "Processar de novo" : "Gerar cortes";
}

function renderProgress() {
  const el = $("#progress");
  if (state.phase === "idle") {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (state.phase === "error") {
    el.innerHTML = `<div class="err"><strong>Não foi possível concluir.</strong><p>${esc(state.message)}</p></div>`;
    return;
  }
  const items = STEPS.map((label, i) => {
    const cls = i < state.step || state.phase === "done" ? "done" : i === state.step ? "now" : "";
    const pct = i === state.step && state.phase !== "done" && state.stepProgress > 0 ? ` <em>${Math.round(state.stepProgress * 100)}%</em>` : "";
    return `<li class="${cls}"><span class="dot"></span>${label}${pct}</li>`;
  }).join("");
  const done = state.phase === "done";
  el.innerHTML = `<p class="msg">${done ? "Pronto! Revise, ajuste e baixe os cortes." : esc(state.message)}</p>
    <ol class="steps">${items}</ol>
    ${done ? "" : `<p class="hint">Deixe esta aba aberta e visível: a transcrição e a gravação acontecem no seu aparelho${TOUCH ? " (mantenha a tela ligada)" : ""}.</p>`}`;
}

function clipCard(c: Clip) {
  const dur = formatDuration(c.end - c.start);
  const media =
    c.status === "done" && c.url
      ? `<video src="${c.url}" ${c.poster ? `poster="${c.poster}"` : ""} controls playsinline preload="metadata"></video>`
      : c.status === "rendering" || c.status === "queued"
        ? `<div class="ph"><div class="bar"><i style="width:${Math.round(c.progress * 100)}%" data-bar="${c.id}"></i></div><span>${c.status === "queued" ? "Na fila..." : esc(c.stage ?? "Gravando...")}</span></div>`
        : c.status === "error"
          ? `<div class="ph err-ph"><span>${esc(c.error ?? "Falhou")}</span></div>`
          : `<div class="ph"><button type="button" class="btn ghost" data-act="render" data-id="${c.id}">Gerar este corte</button></div>`;
  const tone = c.score >= 85 ? "hi" : c.score >= 70 ? "mid" : "lo";
  const edit = c.open
    ? `<div class="edit">
        <div class="row2">
          <label>Início (s)<input type="number" step="0.5" min="0" value="${c.start.toFixed(1)}" data-f="start" data-id="${c.id}"></label>
          <label>Fim (s)<input type="number" step="0.5" min="0" value="${c.end.toFixed(1)}" data-f="end" data-id="${c.id}"></label>
        </div>
        ${
          state.settings.layout === "fill"
            ? `<label>Enquadramento<select data-f="cropMode" data-id="${c.id}"><option value="auto" ${c.cropX === null ? "selected" : ""}>Seguir o rosto automaticamente</option><option value="manual" ${c.cropX !== null ? "selected" : ""}>Posição fixa</option></select></label>
               ${c.cropX !== null ? `<label>Posição<input type="range" min="0" max="100" value="${Math.round(c.cropX * 100)}" data-f="cropX" data-id="${c.id}"><small>Esquerda ↔ direita</small></label>` : ""}`
            : ""
        }
        <label>Estilo da legenda<select data-f="preset" data-id="${c.id}">${(Object.keys(CAPTION_PRESETS) as CaptionPresetId[])
          .map((p) => `<option value="${p}" ${c.preset === p ? "selected" : ""}>${CAPTION_PRESETS[p].label}</option>`)
          .join("")}</select></label>
        <label>Título na tela<input type="text" maxlength="60" value="${esc(c.title_on_screen || c.title)}" data-f="title_on_screen" data-id="${c.id}"></label>
        <label class="check"><input type="checkbox" ${c.showTitle ? "checked" : ""} data-f="showTitle" data-id="${c.id}"> Mostrar título nos primeiros segundos</label>
        <label class="check"><input type="checkbox" ${c.removeSilences ? "checked" : ""} data-f="removeSilences" data-id="${c.id}"> Remover pausas</label>
        <button type="button" class="btn" data-act="render" data-id="${c.id}">Gerar de novo</button>
      </div>`
    : "";
  return `<article class="clip" id="${c.id}">
    <div class="media">${media}<span class="rank">#${String(c.rank).padStart(2, "0")}</span><span class="dur">${dur}</span></div>
    <div class="body">
      <div class="meta"><span class="score ${tone}">${c.score}<small>/100</small></span><span class="ret">Retenção: ${esc(c.retentionPotential)}</span></div>
      <h3>${esc(c.title)}</h3>
      ${c.hook ? `<p class="hook">“${esc(c.hook)}”</p>` : ""}
      <details><summary>Legenda para o post e hashtags</summary><p>${esc(c.social_caption)}</p><p class="tags">${esc(c.hashtags.join(" "))}</p><button type="button" class="link" data-act="copy" data-id="${c.id}">Copiar legenda</button></details>
      <div class="actions">
        <button type="button" class="btn" data-act="download" data-id="${c.id}" ${c.blob && downloads ? "" : "disabled"}>Baixar</button>
        <button type="button" class="btn ghost" data-act="toggle" data-id="${c.id}">${c.open ? "Fechar ajustes" : "Ajustar"}</button>
        <button type="button" class="btn ghost danger" data-act="remove" data-id="${c.id}" aria-label="Excluir corte">Excluir</button>
      </div>
      ${edit}
    </div>
  </article>`;
}

function renderResults() {
  const el = $("#results");
  if (!state.clips.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const ready = state.clips.filter((c) => c.blob).length;
  el.innerHTML = `
    <div class="res-head">
      <h2>Cortes encontrados <span>${state.clips.length}</span></h2>
      <button type="button" class="btn" id="zip" ${ready && downloads ? "" : "disabled"}>Baixar todos (.zip, ${ready})</button>
    </div>
    ${format?.ext === "webm" ? `<p class="note">Seu navegador grava em WebM. Para MP4 (melhor para Instagram), use o Chrome ou Edge atualizados, ou o Safari.</p>` : ""}
    ${!downloads ? `<p class="note">Para baixar os arquivos, abra este artefato no claude.ai.</p>` : ""}
    <div class="grid">${state.clips.map(clipCard).join("")}</div>`;
}

function updateClipProgress(c: Clip) {
  const bar = document.querySelector<HTMLElement>(`[data-bar="${c.id}"]`);
  if (bar) bar.style.width = `${Math.round(c.progress * 100)}%`;
}

function renderNotice() {
  const el = $("#notice");
  el.hidden = !state.notice;
  el.textContent = state.notice;
}

function renderAll() {
  renderDrop();
  renderProgress();
  renderResults();
  renderNotice();
}

// ---------------------------------------------------------------- eventos
function pickFile(f: File | undefined) {
  if (!f) return;
  const ok = /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name) || f.type.startsWith("video/");
  if (!ok) {
    state.notice = "Formato não suportado. Envie um vídeo MP4, MOV ou WEBM.";
  } else if (f.size > MAX_FILE_BYTES) {
    state.notice = "Este arquivo passa de 2 GB. Exporte o vídeo numa resolução menor (720p já é suficiente para os cortes) e tente de novo.";
  } else {
    state.file = f;
    state.duration = 0;
    state.notice = "";
    state.phase = "idle";
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      state.duration = probe.duration;
      renderDrop();
      URL.revokeObjectURL(probe.src);
    };
    probe.src = URL.createObjectURL(f);
  }
  renderAll();
}

function init() {
  const drop = $("#drop");
  const input = $<HTMLInputElement>("#file");
  input.addEventListener("change", () => {
    pickFile(input.files?.[0]);
    input.value = ""; // permite escolher o mesmo arquivo de novo
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (state.phase !== "working") pickFile(e.dataTransfer?.files?.[0]);
  });
  $("#go").addEventListener("click", () => void start());

  $("#results").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act], #zip");
    if (!t) return;
    if (t.id === "zip") return void downloadAll();
    const c = state.clips.find((x) => x.id === t.dataset.id);
    if (!c) return;
    const act = t.dataset.act;
    if (act === "render") {
      ensureAudioGraph();
      c.open = false;
      void enqueueRender(c);
    } else if (act === "download" && c.blob) void saveBlob(fileName(c), c.blob);
    else if (act === "toggle") {
      c.open = !c.open;
      renderResults();
    } else if (act === "remove") {
      state.clips = state.clips.filter((x) => x !== c);
      if (c.url) URL.revokeObjectURL(c.url);
      renderResults();
    } else if (act === "copy") {
      const text = `${c.social_caption}\n\n${c.hashtags.join(" ")}`;
      navigator.clipboard?.writeText(text).then(
        () => (t.textContent = "Copiado"),
        () => (t.textContent = "Selecione o texto acima para copiar"),
      );
    }
  });
  $("#results").addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const c = state.clips.find((x) => x.id === t.dataset.id);
    if (!c || !t.dataset.f) return;
    const f = t.dataset.f;
    if (f === "start" || f === "end") {
      const v = Math.max(0, Math.min(state.duration, Number(t.value)));
      if (f === "start" && v < c.end - 3) c.start = v;
      if (f === "end" && v > c.start + 3) c.end = v;
    } else if (f === "cropX") c.cropX = Number(t.value) / 100;
    else if (f === "cropMode") {
      c.cropX = t.value === "auto" ? null : 0.5;
      renderResults();
    }
    else if (f === "preset") c.preset = t.value as CaptionPresetId;
    else if (f === "title_on_screen") c.title_on_screen = t.value;
    else if (f === "showTitle") c.showTitle = t.checked;
    else if (f === "removeSilences") c.removeSilences = t.checked;
  });

  if (!format) {
    state.notice = "Este navegador não consegue gravar vídeo. Use o Chrome (Android/computador), o Safari (iPhone) ou o Edge atualizados.";
  }
  renderSettings();
  renderAll();
}

init();
