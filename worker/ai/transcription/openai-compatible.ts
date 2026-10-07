import fs from "node:fs/promises";
import path from "node:path";
import type { Segment, Word } from "@/lib/types";
import type { TranscriptionProvider, TranscriptionResult } from "./types";

type VerboseJson = {
  text: string;
  language?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
  segments?: { start: number; end: number; text: string }[];
};

/**
 * Cliente para a API de transcrição no formato OpenAI (`/audio/transcriptions`),
 * usada pela OpenAI (whisper-1) e pela Groq (whisper-large-v3 / -turbo).
 * Pedimos `verbose_json` com timestamps por PALAVRA — essenciais para cortes
 * precisos, remoção de pausas e legendas sincronizadas.
 */
export class OpenAICompatibleTranscription implements TranscriptionProvider {
  readonly maxFileBytes = 25 * 1024 * 1024;

  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {
    if (!apiKey) throw new Error(`API key ausente para o provedor de transcrição "${name}"`);
  }

  async transcribe(filePath: string, opts: { language?: string | null; prompt?: string }): Promise<TranscriptionResult> {
    const buf = await fs.readFile(filePath);
    if (buf.byteLength > this.maxFileBytes) throw new Error(`Arquivo de áudio excede ${this.maxFileBytes} bytes`);

    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/mpeg" }), path.basename(filePath));
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("temperature", "0");
    if (opts.language) form.append("language", opts.language);
    if (opts.prompt) form.append("prompt", opts.prompt.slice(0, 800));

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(10 * 60 * 1000),
      }).catch((e) => e as Error);
      if (res instanceof Error) {
        lastErr = res;
      } else if (res.ok) {
        return this.parse((await res.json()) as VerboseJson);
      } else {
        const body = await res.text();
        lastErr = new Error(`${this.name} transcription HTTP ${res.status}: ${body.slice(0, 500)}`);
        // 4xx (exceto 408/429) não adianta repetir
        if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
        const retryAfter = Number(res.headers.get("retry-after"));
        await new Promise((r) => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000));
        continue;
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
    throw lastErr;
  }

  private parse(data: VerboseJson): TranscriptionResult {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const words: Word[] = (data.words ?? [])
      .map((w) => ({ w: String(w.word ?? "").trim(), s: r3(Number(w.start)), e: r3(Number(w.end)) }))
      .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e))
      .map((w) => (w.e <= w.s ? { ...w, e: r3(w.s + 0.05) } : w));
    const segments: Segment[] = (data.segments ?? []).map((s) => ({ s: r3(s.start), e: r3(s.end), t: String(s.text ?? "").trim() }));
    return { text: data.text ?? "", language: data.language ?? null, words, segments, duration: data.duration ?? null };
  }
}
