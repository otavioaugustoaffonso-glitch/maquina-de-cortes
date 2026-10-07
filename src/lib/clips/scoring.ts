import type { AiScores, ScoreBreakdown, SpeechMetrics } from "../types";

/**
 * Pesos do score final (somam 1.0).
 * - Fatores semânticos (gancho, clareza, valor, emoção, curiosidade, contexto) vêm da IA.
 * - "flow" é calculado localmente a partir dos timestamps (pausas, ritmo, vícios).
 */
export const SCORE_WEIGHTS = {
  hook: 0.24,
  standalone: 0.15,
  value: 0.15,
  clarity: 0.1,
  emotion: 0.1,
  curiosity: 0.1,
  flow: 0.16,
} as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function sanitizeAiScores(s: Partial<AiScores> | undefined): AiScores {
  const v = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? clamp(n, 0, 10) : 5);
  return {
    hook: v(s?.hook),
    clarity: v(s?.clarity),
    value: v(s?.value),
    emotion: v(s?.emotion),
    curiosity: v(s?.curiosity),
    standalone: v(s?.standalone),
  };
}

/**
 * Nota 0..10 de fluidez da fala:
 * - ritmo ideal para vídeo curto ~2.3–3.6 palavras/s
 * - penaliza pausas, vícios de linguagem e cortes no meio de frases
 */
export function flowScore(m: SpeechMetrics): number {
  if (m.wordCount === 0) return 0;
  let score = 10;
  const wps = m.wordsPerSecond;
  if (wps < 2.3) score -= Math.min(4, (2.3 - wps) * 3);
  if (wps > 4.2) score -= Math.min(2, (wps - 4.2) * 2);
  score -= Math.min(4, m.pauseRatio * 12);
  if (m.longestPause > 2) score -= Math.min(1.5, (m.longestPause - 2) * 0.5);
  score -= Math.min(2, m.fillerRatio * 25);
  if (!m.startsClean) score -= 1;
  if (!m.endsClean) score -= 1;
  return Math.round(clamp(score, 0, 10) * 10) / 10;
}

export function retentionLabel(score: number): string {
  if (score >= 85) return "Muito alto";
  if (score >= 70) return "Alto";
  if (score >= 55) return "Médio";
  return "Baixo";
}

export function computeScore(ai: AiScores, metrics: SpeechMetrics): { score: number; breakdown: ScoreBreakdown; retentionPotential: string } {
  const flow = flowScore(metrics);
  const weighted =
    ai.hook * SCORE_WEIGHTS.hook +
    ai.standalone * SCORE_WEIGHTS.standalone +
    ai.value * SCORE_WEIGHTS.value +
    ai.clarity * SCORE_WEIGHTS.clarity +
    ai.emotion * SCORE_WEIGHTS.emotion +
    ai.curiosity * SCORE_WEIGHTS.curiosity +
    flow * SCORE_WEIGHTS.flow;
  const score = Math.round(clamp(weighted * 10, 0, 100));
  return { score, breakdown: { ...ai, flow, metrics }, retentionPotential: retentionLabel(score) };
}
