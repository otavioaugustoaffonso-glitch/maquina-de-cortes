/**
 * Web Worker de transcrição: Whisper (open source) rodando no navegador via
 * transformers.js + ONNX Runtime (WebAssembly). Nada sai do computador do usuário.
 *
 * Os modelos são publicados junto com a página em partes de texto base64 (artefatos
 * só servem tipos web, até 16 MB por arquivo) e remontados aqui por um fetch personalizado.
 */
import { env, pipeline, WhisperTextStreamer } from "@huggingface/transformers";

type Manifest = { files: Record<string, { parts: number; size: number }> };
type InMsg = { type: "transcribe"; audio: Float32Array; language: string | null };
export type OutMsg =
  | { type: "status"; stage: "download" | "prepare" | "load" | "transcribe"; progress: number; done?: number; total?: number }
  | { type: "result"; text: string; chunks: { text: string; timestamp: [number, number | null] }[] }
  | { type: "error"; message: string };

const BASE = new URL("./", self.location.href).href;
const MODEL = "whisper-base";
const post = (m: OutMsg) => (self as unknown as Worker).postMessage(m);

let manifestPromise: Promise<Manifest> | null = null;
const assembled = new Map<string, Promise<Blob>>();
let downloadedBytes = 0;
let totalBytes = 0;

function manifest(): Promise<Manifest> {
  manifestPromise ??= fetch(new URL("models/manifest.json", BASE)).then((r) => {
    if (!r.ok) throw new Error(`Não foi possível carregar o modelo de transcrição (HTTP ${r.status}).`);
    return r.json() as Promise<Manifest>;
  });
  return manifestPromise;
}

/** Baixa uma parte (texto base64) e devolve os bytes originais. */
async function fetchPart(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar o modelo (HTTP ${res.status})`);
  const bytes = base64ToBytes(await res.text());
  downloadedBytes += bytes.byteLength;
  if (totalBytes) post({ type: "status", stage: "download", progress: Math.min(1, downloadedBytes / totalBytes) });
  // download terminado: a montagem do modelo (pode levar um tempo no celular) começa agora
  if (totalBytes && downloadedBytes >= totalBytes) post({ type: "status", stage: "prepare", progress: 0 });
  return bytes;
}

function base64ToBytes(b64: string): Uint8Array {
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (fromBase64) return fromBase64(b64.trim());
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** fetch usado pelo transformers.js: remonta arquivos divididos em partes. */
async function partsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, BASE).href;
  const m = await manifest();
  const key = url.startsWith(BASE) ? url.slice(BASE.length) : null;
  const entry = key ? m.files[key] : undefined;
  if (!entry) return fetch(url, init);

  const range = new Headers(init?.headers).get("Range");
  if (range === "bytes=0-0") {
    // pedido de metadados: informa o tamanho sem baixar
    return new Response(new Uint8Array(1), {
      status: 206,
      headers: { "content-range": `bytes 0-0/${entry.size}`, "content-length": "1" },
    });
  }
  if (!assembled.has(url)) {
    assembled.set(
      url,
      (async () => {
        const parts: Uint8Array[] = [];
        for (let i = 0; i < entry.parts; i++) parts.push(await fetchPart(`${url}.part${i}.txt`));
        return new Blob(parts as BlobPart[]);
      })(),
    );
  }
  const blob = await assembled.get(url)!;
  return new Response(blob, { status: 200, headers: { "content-length": String(blob.size) } });
}

env.allowRemoteModels = false;
env.allowLocalModels = true;
// caminho relativo: o transformers.js trata como "arquivo local" e verifica a existência via fetch
env.localModelPath = "./models/";
env.useBrowserCache = false;
// O ONNX Runtime carrega o próprio .mjs e o .wasm publicados com a página
(env as unknown as { useWasmCache: boolean }).useWasmCache = false;
(env as unknown as { fetch: typeof fetch }).fetch = partsFetch as typeof fetch;
const onnx = env.backends.onnx as unknown as { wasm: { wasmPaths: unknown; numThreads: number; proxy: boolean } };
onnx.wasm.wasmPaths = {
  mjs: new URL("ort/ort-wasm-simd-threaded.mjs", BASE).href,
  wasm: new URL("ort/ort-wasm-simd-threaded.wasm", BASE).href,
};
onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
onnx.wasm.proxy = false;

type Transcriber = ((
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>) & {
  tokenizer: ConstructorParameters<typeof WhisperTextStreamer>[0];
};
let transcriber: Promise<Transcriber> | null = null;

async function load(): Promise<Transcriber> {
  const m = await manifest();
  totalBytes = Object.entries(m.files)
    .filter(([k]) => k.startsWith(`models/${MODEL}/`))
    .reduce((a, [, v]) => a + v.size, 0);
  post({ type: "status", stage: "download", progress: 0 });
  const t = await pipeline("automatic-speech-recognition", MODEL, { device: "wasm", dtype: "q8" });
  return t as unknown as Transcriber;
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type !== "transcribe") return;
  try {
    transcriber ??= load();
    const t = await transcriber;
    post({ type: "status", stage: "load", progress: 1 });

    // Processa em janelas de 30 s para mostrar progresso e não travar
    const SR = 16000;
    const WINDOW = 30 * SR;
    const total = msg.audio.length / SR;
    const chunks: { text: string; timestamp: [number, number | null] }[] = [];
    const texts: string[] = [];
    let offset = 0;
    let lastPost = 0;
    // sinal de vida a cada token gerado (no celular uma janela pode levar mais de um minuto)
    const tick = (inWindow: number) => {
      const now = Date.now();
      if (now - lastPost < 1000) return;
      lastPost = now;
      const done = Math.min(total, offset + inWindow);
      post({ type: "status", stage: "transcribe", progress: done / total, done, total });
    };
    let windowPos = 0;
    const streamer = new WhisperTextStreamer(t.tokenizer, {
      skip_prompt: true,
      token_callback_function: () => tick(windowPos),
      on_chunk_end: (s: number) => {
        windowPos = Math.max(windowPos, s);
        tick(windowPos);
      },
    });
    for (let start = 0; start < msg.audio.length; start += WINDOW) {
      const slice = msg.audio.subarray(start, Math.min(msg.audio.length, start + WINDOW));
      offset = start / SR;
      windowPos = 0;
      // pula janelas praticamente silenciosas (economiza tempo)
      let energy = 0;
      for (let i = 0; i < slice.length; i += 16) energy += slice[i] * slice[i];
      if (energy / (slice.length / 16) < 1e-6) continue;
      const out = await t(slice, {
        language: msg.language ?? undefined,
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        // 30 s de fala rápida cabem em ~200 tokens; o limite evita laços de repetição que travam
        max_new_tokens: 224,
        streamer,
      });
      for (const c of out.chunks ?? []) {
        const s = (c.timestamp[0] ?? 0) + offset;
        const e = c.timestamp[1] == null ? Math.min(offset + slice.length / SR, s + 5) : c.timestamp[1] + offset;
        if (c.text.trim()) chunks.push({ text: c.text.trim(), timestamp: [s, e] });
      }
      texts.push(out.text.trim());
      const done = Math.min(total, offset + slice.length / SR);
      lastPost = Date.now();
      post({ type: "status", stage: "transcribe", progress: done / total, done, total });
    }
    post({ type: "result", text: texts.join(" "), chunks });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
