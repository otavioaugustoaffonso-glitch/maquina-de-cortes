import { describe, expect, it } from "vitest";
import {
  computeKeepSegments, remapTime, remapWords, snapToWords, speechMetrics, totalDuration, trimLeadingFillers,
} from "@/lib/clips/timing";
import type { Word } from "@/lib/types";

const words: Word[] = [
  { w: "Bom,", s: 10.0, e: 10.3 },
  { w: "pessoal,", s: 10.4, e: 10.9 },
  { w: "então", s: 11.0, e: 11.3 },
  { w: "Você", s: 11.5, e: 11.8 },
  { w: "está", s: 11.8, e: 12.0 },
  { w: "perdendo", s: 12.0, e: 12.5 },
  { w: "dinheiro", s: 12.5, e: 13.0 },
  { w: "todos", s: 15.0, e: 15.3 }, // pausa de 2s antes
  { w: "os", s: 15.3, e: 15.4 },
  { w: "meses.", s: 15.4, e: 16.0 },
];

describe("timing", () => {
  it("remove introduções vazias do início do corte", () => {
    expect(trimLeadingFillers(words, 10, 16)).toBeCloseTo(11.45, 2);
  });

  it("não remove se o corte já começa com conteúdo", () => {
    expect(trimLeadingFillers(words, 11.4, 16)).toBe(11.4);
  });

  it("ajusta início/fim às palavras", () => {
    const r = snapToWords(words, 11.6, 15.35);
    expect(r.start).toBeCloseTo(11.42, 2); // começa no início de "Você"
    expect(r.end).toBeCloseTo(15.65, 2); // termina depois de "os"
  });

  it("calcula trechos removendo pausas longas e remapeia o tempo", () => {
    const segs = computeKeepSegments(words, 11.4, 16.2, { maxGap: 0.6, pad: 0.1 });
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ s: 11.4, e: 13.1 });
    expect(segs[1]).toEqual({ s: 14.9, e: 16.1 });
    expect(totalDuration(segs)).toBeCloseTo(2.9, 3);
    expect(remapTime(15.0, segs)).toBeCloseTo(1.8, 3);
    expect(remapTime(14.0, segs)).toBeCloseTo(1.7, 3); // dentro da pausa => início do próximo trecho
    const out = remapWords(words, segs);
    expect(out[0]).toEqual({ w: "Você", s: 0.1, e: 0.4 });
    expect(out[out.length - 1].e).toBeLessThanOrEqual(totalDuration(segs));
  });

  it("métricas de fala detectam pausas", () => {
    const m = speechMetrics(words, 11.4, 16.1);
    expect(m.wordCount).toBe(7);
    expect(m.longestPause).toBeCloseTo(2, 3);
    expect(m.pauseRatio).toBeGreaterThan(0.4);
    expect(m.endsClean).toBe(true);
  });
});
