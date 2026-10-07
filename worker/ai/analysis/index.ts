import { env } from "../../env";
import { assertPaidAllowed } from "../paid-guard";
import { AnthropicAnalyzer } from "./anthropic";
import { HeuristicAnalyzer } from "./heuristic";
import { OpenAICompatibleAnalyzer } from "./openai-compatible";
import type { ClipAnalyzer } from "./types";

export type { AnalysisInput, AnalysisResult, ClipAnalyzer } from "./types";

/**
 * Seleciona o provedor pela variável ANALYSIS_PROVIDER:
 *   heuristic — regras locais, custo zero [padrão]
 *   gemini    — Google AI Studio, plano gratuito
 *   groq      — GroqCloud, plano gratuito
 *   ollama    — modelo aberto local, custo zero
 *   openai-compatible — outro endpoint compatível (LLM_BASE_URL)
 *   anthropic — Claude, pago (exige ALLOW_PAID_PROVIDERS=true)
 */
export function getClipAnalyzer(): ClipAnalyzer {
  switch (env.analysisProvider) {
    case "heuristic":
      return new HeuristicAnalyzer();
    case "gemini":
    case "groq":
    case "ollama":
    case "openai-compatible":
      return new OpenAICompatibleAnalyzer(env.analysisProvider);
    case "anthropic":
      assertPaidAllowed("anthropic");
      return new AnthropicAnalyzer();
    default:
      throw new Error(`ANALYSIS_PROVIDER inválido: ${env.analysisProvider}`);
  }
}
