import { env } from "../../env";
import { HeuristicAnalyzer } from "./heuristic";
import { OpenAICompatibleAnalyzer } from "./openai-compatible";
import type { ClipAnalyzer } from "./types";

export type { AnalysisInput, AnalysisResult, ClipAnalyzer } from "./types";

/**
 * Seleciona o provedor pela variável ANALYSIS_PROVIDER. Todos são gratuitos:
 *   heuristic — regras locais, sem instalar nada [padrão]
 *   ollama    — modelo de IA aberto rodando na sua máquina (recomendado)
 *   openai-compatible — outro servidor local compatível (LM Studio, llama.cpp, vLLM)
 *   gemini    — Google AI Studio, plano gratuito (opcional)
 *   groq      — GroqCloud, plano gratuito (opcional)
 */
export function getClipAnalyzer(): ClipAnalyzer {
  switch (env.analysisProvider) {
    case "heuristic":
      return new HeuristicAnalyzer();
    case "ollama":
    case "openai-compatible":
    case "gemini":
    case "groq":
      return new OpenAICompatibleAnalyzer(env.analysisProvider);
    default:
      throw new Error(`ANALYSIS_PROVIDER inválido: ${env.analysisProvider} (use heuristic, ollama, openai-compatible, gemini ou groq)`);
  }
}
