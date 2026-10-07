import { env } from "../../env";
import { AnthropicAnalyzer } from "./anthropic";
import { HeuristicAnalyzer } from "./heuristic";
import type { ClipAnalyzer } from "./types";

export type { AnalysisInput, AnalysisResult, ClipAnalyzer } from "./types";

/** Seleciona o provedor pela variável ANALYSIS_PROVIDER. */
export function getClipAnalyzer(): ClipAnalyzer {
  switch (env.analysisProvider) {
    case "anthropic":
      return new AnthropicAnalyzer();
    case "heuristic":
      return new HeuristicAnalyzer();
    default:
      throw new Error(`ANALYSIS_PROVIDER inválido: ${env.analysisProvider}`);
  }
}
