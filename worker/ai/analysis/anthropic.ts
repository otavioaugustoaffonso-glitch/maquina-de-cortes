import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PermanentError } from "../../queue";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { AnalysisSchema } from "./schema";
import type { AnalysisInput, AnalysisResult, ClipAnalyzer } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Análise de cortes com Claude (Anthropic).
 * - Uma única chamada por vídeo (ou por janela, em vídeos muito longos).
 * - Envia SOMENTE o texto da transcrição — nunca vídeo/áudio.
 * - Resposta em JSON estruturado validado por schema (sem parsing frágil).
 * - Streaming para evitar timeouts em respostas longas.
 */
export class AnthropicAnalyzer implements ClipAnalyzer {
  readonly name = "anthropic";
  readonly model: string;
  private readonly effort: Effort;
  private readonly client: Anthropic;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não definida");
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
    this.model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
    this.effort = (process.env.ANTHROPIC_EFFORT as Effort) || "high";
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort, format: betaZodOutputFormat(AnalysisSchema) },
      // Se a requisição for recusada pelos classificadores de segurança,
      // a API tenta automaticamente um modelo alternativo adequado.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new PermanentError("A IA recusou analisar este conteúdo.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("Resposta da IA truncada (max_tokens). Tente novamente.");
    }
    const parsed = message.parsed_output;
    if (!parsed) throw new Error("Resposta da IA não pôde ser interpretada.");

    return {
      clips: parsed.clips,
      model: message.model,
      usage: {
        inputTokens:
          message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
      },
    };
  }
}
