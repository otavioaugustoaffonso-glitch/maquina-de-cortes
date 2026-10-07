import type { RawClipCandidate } from "@/lib/types";

export type AnalysisInput = {
  /** Transcrição já formatada: "[inicio-fim] texto" por linha. */
  transcript: string;
  durationSeconds: number;
  language: string | null;
  clipCount: { min: number; max: number };
  projectName?: string;
  /** Início/fim desta janela, quando a transcrição foi dividida. */
  window?: { start: number; end: number; index: number; total: number };
};

export type AnalysisResult = {
  clips: RawClipCandidate[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

/**
 * Contrato de um provedor de análise (LLM). Para trocar de provedor,
 * implemente esta interface e registre em ./index.ts.
 */
export interface ClipAnalyzer {
  readonly name: string;
  readonly model: string;
  /** Tamanho máximo da transcrição por chamada (limites de contexto/plano gratuito). */
  readonly maxTranscriptChars?: number;
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
