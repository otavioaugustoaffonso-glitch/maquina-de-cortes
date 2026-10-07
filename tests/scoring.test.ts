import { describe, expect, it } from "vitest";
import { finalizeCandidates, targetClipCount } from "@/lib/clips/candidates";
import { computeScore, flowScore } from "@/lib/clips/scoring";
import { formatTranscriptForPrompt, mergeChunkTranscripts, punctuateWordsFromSegments, splitTranscriptWindows, wordsToSegments } from "@/lib/ai/transcript";
import type { RawClipCandidate, Word } from "@/lib/types";

// 200s de fala contínua, 1 palavra a cada 0.4s, frase a cada 10 palavras
const words: Word[] = Array.from({ length: 500 }, (_, i) => ({
  w: i % 10 === 9 ? `palavra${i}.` : i === 250 ? "Bom," : `palavra${i}`,
  s: i * 0.4,
  e: i * 0.4 + 0.33,
}));

const base: Omit<RawClipCandidate, "start" | "end" | "scores"> = {
  title: "Título", description: "d", hook: "h", reason: "r", category: "dica",
  keywords: ["dinheiro"], hashtags: ["financas", "#dinheiro"], social_caption: "c", title_on_screen: "T",
};

describe("pontuação e candidatos", () => {
  it("score maior para gancho forte e fala fluida", () => {
    const m = { wordCount: 100, wordsPerSecond: 2.8, pauseRatio: 0.02, longestPause: 0.5, fillerRatio: 0, startsClean: true, endsClean: true };
    const strong = computeScore({ hook: 10, clarity: 9, value: 9, emotion: 8, curiosity: 9, standalone: 10 }, m);
    const weak = computeScore({ hook: 3, clarity: 6, value: 4, emotion: 3, curiosity: 3, standalone: 4 }, { ...m, pauseRatio: 0.4, startsClean: false });
    expect(strong.score).toBeGreaterThan(90);
    expect(weak.score).toBeLessThan(50);
    expect(strong.retentionPotential).toBe("Muito alto");
    expect(flowScore({ ...m, wordCount: 0 })).toBe(0);
  });

  it("ordena, remove sobreposições e corta intros", () => {
    const raw: RawClipCandidate[] = [
      { ...base, start: 40, end: 70, scores: { hook: 5, clarity: 5, value: 5, emotion: 5, curiosity: 5, standalone: 5 } },
      { ...base, start: 42, end: 72, scores: { hook: 9, clarity: 9, value: 9, emotion: 9, curiosity: 9, standalone: 9 } },
      { ...base, start: 100, end: 130, scores: { hook: 7, clarity: 7, value: 7, emotion: 7, curiosity: 7, standalone: 7 } },
      { ...base, start: 150, end: 152, scores: { hook: 10, clarity: 10, value: 10, emotion: 10, curiosity: 10, standalone: 10 } }, // curto demais
      { ...base, start: Number.NaN, end: 10, scores: { hook: 10, clarity: 10, value: 10, emotion: 10, curiosity: 10, standalone: 10 } },
    ];
    const out = finalizeCandidates(raw, words, 200);
    expect(out).toHaveLength(2);
    expect(out[0].rank).toBe(1);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[0].start).toBeCloseTo(41.92, 2);
    expect(out[0].hashtags).toEqual(["#financas", "#dinheiro"]);
    // "Bom," em 100s foi removido do início do corte que começava em 100
    expect(out[1].start).toBeGreaterThan(100);
  });

  it("quantidade de cortes proporcional à duração", () => {
    expect(targetClipCount(60 * 60)).toEqual({ min: 12, max: 24 });
    expect(targetClipCount(120).max).toBe(3);
  });
});

describe("transcrição", () => {
  it("segmenta, formata e divide em janelas", () => {
    const segs = wordsToSegments(words);
    expect(segs[0].t.endsWith("palavra9.")).toBe(true);
    expect(formatTranscriptForPrompt(segs.slice(0, 1))).toMatch(/^\[0\.0-3\.9\] palavra0/);
    const wins = splitTranscriptWindows(segs, 2000, 10);
    expect(wins.length).toBeGreaterThan(1);
    expect(wins[wins.length - 1].at(-1)).toEqual(segs.at(-1));
  });

  it("junta pedaços aplicando offset", () => {
    const merged = mergeChunkTranscripts([
      { offset: 0, words: [{ w: "a", s: 0, e: 1 }], segments: [{ s: 0, e: 1, t: "a" }], text: "a" },
      { offset: 600, words: [{ w: "b", s: 0.5, e: 1 }], segments: [{ s: 0.5, e: 1, t: "b" }], text: "b" },
    ]);
    expect(merged.words[1]).toEqual({ w: "b", s: 600.5, e: 601 });
    expect(merged.text).toBe("a b");
  });

  it("reaplica pontuação dos segmentos às palavras", () => {
    const out = punctuateWordsFromSegments(
      [{ w: "Olá", s: 0, e: 0.3 }, { w: "mundo", s: 0.3, e: 0.6 }, { w: "tudo", s: 1, e: 1.2 }, { w: "bem", s: 1.2, e: 1.5 }],
      [{ s: 0, e: 0.6, t: "Olá, mundo." }, { s: 1, e: 1.5, t: "Tudo bem?" }],
    );
    expect(out.map((w) => w.w)).toEqual(["Olá,", "mundo.", "Tudo", "bem?"]);
  });
});
