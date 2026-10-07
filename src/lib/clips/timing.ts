import type { SpeechMetrics, Word } from "../types";

/** Palavras/expressões de preenchimento (pt-BR + en) removidas do início dos cortes. */
const FILLERS = new Set([
  "bom", "então", "entao", "pessoal", "gente", "galera", "é", "e", "éé", "eh", "ah", "ahn", "hum", "hmm",
  "tipo", "assim", "né", "ne", "olha", "beleza", "ok", "okay", "enfim", "aí", "ai", "bem", "pois", "daí",
  "uh", "um", "uhm", "so", "well", "like", "yeah", "basically", "alright", "right",
]);

/** Fillers contados como vício de linguagem em qualquer posição (métrica de fluidez). */
const MID_FILLERS = new Set(["éé", "eh", "ahn", "hum", "hmm", "uh", "um", "uhm", "tipo", "né"]);

export function normalizeToken(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isFiller(w: string): boolean {
  return FILLERS.has(normalizeToken(w));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Palavras que se sobrepõem ao intervalo [start, end]. */
export function wordsInRange(words: Word[], start: number, end: number): Word[] {
  return words.filter((w) => w.e > start && w.s < end);
}

/**
 * Ajusta início/fim para não cortar palavras no meio:
 * início = começo da primeira palavra, fim = final da última palavra (+ respiro).
 */
export function snapToWords(
  words: Word[],
  start: number,
  end: number,
  opts: { padStart?: number; padEnd?: number; maxEnd?: number } = {},
): { start: number; end: number } {
  const { padStart = 0.08, padEnd = 0.25, maxEnd = Number.POSITIVE_INFINITY } = opts;
  const inRange = wordsInRange(words, start, end);
  if (inRange.length === 0) return { start: round3(start), end: round3(Math.min(end, maxEnd)) };
  // Se a primeira palavra começa bem antes do início pedido (ficou cortada), ela é mantida inteira.
  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  const s = Math.max(0, first.s - padStart);
  const e = Math.min(maxEnd, last.e + padEnd);
  return { start: round3(s), end: round3(e) };
}

/**
 * Remove introduções vazias ("Bom, pessoal, então...") do começo do corte,
 * para que ele comece direto na parte interessante da fala.
 */
export function trimLeadingFillers(
  words: Word[],
  start: number,
  end: number,
  opts: { maxWords?: number; maxSeconds?: number } = {},
): number {
  const { maxWords = 5, maxSeconds = 4 } = opts;
  const inRange = wordsInRange(words, start, end);
  let i = 0;
  while (i < inRange.length && i < maxWords && isFiller(inRange[i].w) && inRange[i].e - start <= maxSeconds) i++;
  // Precisa sobrar conteúdo
  if (i === 0 || i >= inRange.length - 3) return start;
  return round3(Math.max(start, inRange[i].s - 0.05));
}

export type TimeRange = { s: number; e: number };

/**
 * Calcula os trechos com fala a manter (remoção de silêncios/pausas longas).
 * Pausas maiores que `maxGap` são encurtadas para `keepGap`.
 * Retorna intervalos em tempo do vídeo original, dentro de [start, end].
 */
export function computeKeepSegments(
  words: Word[],
  start: number,
  end: number,
  opts: { maxGap?: number; pad?: number; minSegment?: number } = {},
): TimeRange[] {
  const { maxGap = 0.6, pad = 0.12, minSegment = 0.25 } = opts;
  const inRange = wordsInRange(words, start, end);
  if (inRange.length === 0) return [{ s: start, e: end }];

  const segs: TimeRange[] = [];
  let cur: TimeRange = { s: Math.max(start, inRange[0].s - pad), e: Math.min(end, inRange[0].e + pad) };
  for (let i = 1; i < inRange.length; i++) {
    const w = inRange[i];
    const gap = w.s - inRange[i - 1].e;
    if (gap > maxGap) {
      segs.push(cur);
      cur = { s: Math.max(start, w.s - pad), e: Math.min(end, w.e + pad) };
    } else {
      cur.e = Math.min(end, w.e + pad);
    }
  }
  segs.push(cur);

  // Mantém o início/fim originais do corte (respiro natural)
  segs[0].s = Math.min(segs[0].s, Math.max(start, inRange[0].s - pad));
  segs[segs.length - 1].e = Math.max(segs[segs.length - 1].e, Math.min(end, inRange[inRange.length - 1].e + pad));

  // Funde segmentos que se sobrepõem por causa do padding e remove os minúsculos
  const merged: TimeRange[] = [];
  for (const sg of segs) {
    const prev = merged[merged.length - 1];
    if (prev && sg.s <= prev.e + 0.01) prev.e = Math.max(prev.e, sg.e);
    else merged.push({ ...sg });
  }
  return merged
    .filter((sg) => sg.e - sg.s >= minSegment)
    .map((sg) => ({ s: round3(sg.s), e: round3(sg.e) }));
}

/** Converte um tempo do original para o tempo do vídeo de saída (após remover pausas). */
export function remapTime(t: number, segments: TimeRange[]): number {
  let acc = 0;
  for (const sg of segments) {
    if (t < sg.s) return acc; // dentro de uma pausa removida -> cola no início do próximo trecho
    if (t <= sg.e) return acc + (t - sg.s);
    acc += sg.e - sg.s;
  }
  return acc;
}

export function totalDuration(segments: TimeRange[]): number {
  return round3(segments.reduce((a, sg) => a + (sg.e - sg.s), 0));
}

/** Palavras do corte com tempos já no timeline de saída. */
export function remapWords(words: Word[], segments: TimeRange[]): Word[] {
  const first = segments[0]?.s ?? 0;
  const last = segments[segments.length - 1]?.e ?? 0;
  return wordsInRange(words, first, last)
    .map((w) => ({ w: w.w, s: round3(remapTime(Math.max(w.s, first), segments)), e: round3(remapTime(Math.min(w.e, last), segments)) }))
    .filter((w) => w.e > w.s);
}

/** Métricas locais de qualidade da fala — custo zero, sem IA. */
export function speechMetrics(words: Word[], start: number, end: number): SpeechMetrics {
  const inRange = wordsInRange(words, start, end);
  const duration = Math.max(0.001, end - start);
  if (inRange.length === 0) {
    return { wordCount: 0, wordsPerSecond: 0, pauseRatio: 1, longestPause: duration, fillerRatio: 0, startsClean: false, endsClean: false };
  }
  let pauseTotal = Math.max(0, inRange[0].s - start) + Math.max(0, end - inRange[inRange.length - 1].e);
  let longest = 0;
  for (let i = 1; i < inRange.length; i++) {
    const gap = inRange[i].s - inRange[i - 1].e;
    if (gap > 0.4) pauseTotal += gap;
    longest = Math.max(longest, gap);
  }
  const fillers = inRange.filter((w) => MID_FILLERS.has(normalizeToken(w.w))).length;

  const idx = words.indexOf(inRange[0]);
  const prev = idx > 0 ? words[idx - 1] : undefined;
  const startsClean = !prev || /[.!?…]$/.test(prev.w) || inRange[0].s - prev.e > 0.5 || /^\p{Lu}/u.test(inRange[0].w);
  const lastWord = inRange[inRange.length - 1];
  const next = words[words.indexOf(lastWord) + 1];
  const endsClean = /[.!?…]$/.test(lastWord.w) || !next || next.s - lastWord.e > 0.6;

  return {
    wordCount: inRange.length,
    wordsPerSecond: Math.round((inRange.length / duration) * 100) / 100,
    pauseRatio: Math.round(Math.min(1, pauseTotal / duration) * 1000) / 1000,
    longestPause: round3(longest),
    fillerRatio: Math.round((fillers / inRange.length) * 1000) / 1000,
    startsClean,
    endsClean,
  };
}
