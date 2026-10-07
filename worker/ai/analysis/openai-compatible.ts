import type { RawClipCandidate } from "@/lib/types";
import { log } from "../../log";
import { PermanentError } from "../../queue";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { ClipSchema } from "./schema";
import type { AnalysisInput, AnalysisResult, ClipAnalyzer } from "./types";

/** Formato JSON exigido explicitamente (o modo json_object não impõe schema). */
const JSON_INSTRUCTIONS = `

Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, no formato:
{"clips":[{"start":12.4,"end":48.0,"title":"...","title_on_screen":"...","description":"...","hook":"...","reason":"...","category":"dica","keywords":["..."],"hashtags":["#..."],"social_caption":"...","scores":{"hook":8,"clarity":7,"value":8,"emotion":6,"curiosity":7,"standalone":8}}]}`;

type Preset = { baseUrl: string; model: string; apiKeyEnv?: string; maxChars: number };

/**
 * Provedores com API no formato OpenAI (/chat/completions) e PLANO GRATUITO ou locais:
 *  - gemini: Google AI Studio (plano gratuito com limites por projeto)
 *  - groq:   GroqCloud (plano gratuito; limite baixo de tokens/minuto -> janelas menores)
 *  - ollama: modelos abertos rodando na sua máquina (100% gratuito, offline)
 *  - openai-compatible: qualquer outro endpoint compatível (LM Studio, vLLM, OpenRouter free...)
 */
export const PRESETS: Record<string, Preset> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    maxChars: 400_000,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
    // plano gratuito: ~12 mil tokens/minuto por organização -> janelas de ~5 mil tokens
    maxChars: 16_000,
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    maxChars: 24_000,
  },
  "openai-compatible": {
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    apiKeyEnv: "LLM_API_KEY",
    maxChars: 24_000,
  },
};

export class OpenAICompatibleAnalyzer implements ClipAnalyzer {
  readonly model: string;
  readonly maxTranscriptChars: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(readonly name: string) {
    const preset = PRESETS[name];
    if (!preset) throw new Error(`Provedor de análise desconhecido: ${name}`);
    this.baseUrl = (process.env.LLM_BASE_URL || preset.baseUrl).replace(/\/$/, "");
    this.model = process.env.LLM_MODEL || preset.model;
    this.maxTranscriptChars = Number(process.env.ANALYSIS_MAX_CHARS) || preset.maxChars;
    this.apiKey = (preset.apiKeyEnv && process.env[preset.apiKeyEnv]) || process.env.LLM_API_KEY || "";
    if (preset.apiKeyEnv && !this.apiKey && name !== "openai-compatible") {
      throw new Error(`${preset.apiKeyEnv} não definida para o provedor "${name}"`);
    }
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const body = {
      model: this.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT + JSON_INSTRUCTIONS },
        { role: "user", content: buildUserPrompt(input) },
      ],
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      }).catch((e) => e as Error);

      if (res instanceof Error) {
        lastError = res;
        await sleep(2 ** attempt * 1000);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        // Limite do plano gratuito atingido: espera e tenta de novo (NUNCA gera cobrança)
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(65_000, 5000 * 2 ** attempt);
        lastError = new Error(`${this.name} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        log.warn("limite do provedor gratuito; aguardando", { provider: this.name, status: res.status, waitMs: wait });
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 413) throw new Error(`${this.name}: transcrição grande demais para o limite do plano. Reduza ANALYSIS_MAX_CHARS.`);
        throw new PermanentError(`${this.name} HTTP ${res.status}: ${text.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const clips = parseClips(content);
      if (clips === null) {
        lastError = new Error(`${this.name}: resposta não é JSON válido`);
        continue; // tenta de novo
      }
      return {
        clips,
        model: this.model,
        usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      };
    }
    throw lastError;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extrai e valida os cortes; ignora itens malformados em vez de falhar tudo. */
export function parseClips(content: string): RawClipCandidate[] | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (parsed as { clips?: unknown })?.clips;
  if (!Array.isArray(list)) return null;
  const out: RawClipCandidate[] = [];
  for (const item of list) {
    const withDefaults = {
      title_on_screen: "",
      description: "",
      hook: "",
      reason: "",
      category: "outro",
      keywords: [],
      hashtags: [],
      social_caption: "",
      ...(item as object),
    };
    const r = ClipSchema.safeParse(withDefaults);
    if (r.success) out.push(r.data);
  }
  return out;
}
