import { CLIP_HARD_MAX_SECONDS, CLIP_MIN_SECONDS } from "../constants";
import type { ClipCandidate, RawClipCandidate, Word } from "../types";
import { computeScore, sanitizeAiScores } from "./scoring";
import { snapToWords, speechMetrics, trimLeadingFillers, wordsInRange } from "./timing";

function overlap(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? inter / shorter : 0;
}

const cleanList = (xs: unknown, max: number) =>
  (Array.isArray(xs) ? xs : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);

/**
 * Pós-processamento determinístico dos cortes sugeridos pela IA:
 * 1. ajusta início/fim às palavras (não corta palavra no meio);
 * 2. remove introduções vazias do começo (gancho direto);
 * 3. valida duração (sem forçar cortes de fala importante);
 * 4. calcula score 0..100 combinando IA + métricas locais;
 * 5. remove duplicados/sobrepostos (mantém o melhor);
 * 6. ordena do melhor para o pior.
 */
export function finalizeCandidates(
  raw: RawClipCandidate[],
  words: Word[],
  videoDuration: number,
  opts: { maxClips?: number; maxOverlap?: number } = {},
): ClipCandidate[] {
  const { maxClips = 30, maxOverlap = 0.5 } = opts;
  const scored: ClipCandidate[] = [];

  for (const c of raw) {
    let start = Number(c.start);
    let end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = Math.max(0, start);
    end = Math.min(videoDuration, end);
    if (end - start < CLIP_MIN_SECONDS * 0.6) continue;

    start = trimLeadingFillers(words, start, end);
    ({ start, end } = snapToWords(words, start, end, { maxEnd: videoDuration }));

    const duration = end - start;
    if (duration < CLIP_MIN_SECONDS * 0.8) continue;
    if (duration > CLIP_HARD_MAX_SECONDS) {
      // Muito longo: corta no fim da última frase antes do limite.
      const inside = wordsInRange(words, start, start + CLIP_HARD_MAX_SECONDS);
      const lastSentenceEnd = [...inside].reverse().find((w) => /[.!?…]$/.test(w.w));
      end = lastSentenceEnd && lastSentenceEnd.e - start >= CLIP_MIN_SECONDS ? lastSentenceEnd.e + 0.2 : start + CLIP_HARD_MAX_SECONDS;
    }
    if (wordsInRange(words, start, end).length < 8) continue; // sem conteúdo falado suficiente

    const metrics = speechMetrics(words, start, end);
    const { score, breakdown, retentionPotential } = computeScore(sanitizeAiScores(c.scores), metrics);

    scored.push({
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      title: (c.title || "").trim().slice(0, 140) || "Corte sem título",
      description: (c.description || "").trim().slice(0, 1000),
      hook: (c.hook || "").trim().slice(0, 300),
      reason: (c.reason || "").trim().slice(0, 1000),
      category: (c.category || "outro").trim().slice(0, 40),
      keywords: cleanList(c.keywords, 12),
      hashtags: cleanList(c.hashtags, 15).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
      social_caption: (c.social_caption || "").trim().slice(0, 2200),
      title_on_screen: (c.title_on_screen || c.title || "").trim().slice(0, 80),
      score,
      retentionPotential,
      breakdown,
      rank: 0,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const kept: ClipCandidate[] = [];
  for (const c of scored) {
    if (kept.some((k) => overlap(k, c) > maxOverlap)) continue;
    kept.push(c);
    if (kept.length >= maxClips) break;
  }
  return kept.map((c, i) => ({ ...c, rank: i + 1 }));
}

/** Quantos cortes pedir à IA, proporcional à duração do vídeo. */
export function targetClipCount(durationSeconds: number): { min: number; max: number } {
  const minutes = durationSeconds / 60;
  const max = Math.max(3, Math.min(30, Math.round(minutes / 2.5)));
  const min = Math.max(1, Math.min(max, Math.round(max / 2)));
  return { min, max };
}
