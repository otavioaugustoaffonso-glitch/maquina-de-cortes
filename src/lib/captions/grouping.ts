import { normalizeToken } from "../clips/timing";
import type { CaptionStyle, Word } from "../types";

export type CaptionLine = {
  start: number;
  end: number;
  words: (Word & { keyword: boolean })[];
};

/**
 * Agrupa palavras em "telas" de legenda curtas e sincronizadas.
 * Quebra por: limite de palavras, pontuação final, pausas e limite de caracteres.
 * Usado tanto pelo renderizador (ASS/FFmpeg) quanto pelo preview no navegador,
 * garantindo que o preview seja fiel ao vídeo final.
 */
export function groupCaptionLines(words: Word[], style: Pick<CaptionStyle, "wordsPerLine" | "fontSize">, keywords: string[] = []): CaptionLine[] {
  const kw = new Set(
    keywords.flatMap((k) => k.split(/\s+/)).map(normalizeToken).filter((k) => k.length >= 3),
  );
  // Limite de caracteres proporcional ao tamanho da fonte (largura útil ~920px)
  const maxChars = Math.max(8, Math.round((920 / (style.fontSize * 0.58)) * 1.6));
  const lines: CaptionLine[] = [];
  let cur: CaptionLine | null = null;

  const flush = () => {
    if (cur && cur.words.length) lines.push(cur);
    cur = null;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const text = w.w.trim();
    if (!text) continue;
    const entry = { ...w, w: text, keyword: kw.has(normalizeToken(text)) };
    if (cur) {
      const gap = w.s - cur.end;
      const chars = cur.words.reduce((a, x) => a + x.w.length + 1, 0) + text.length;
      if (cur.words.length >= style.wordsPerLine || gap > 0.7 || chars > maxChars) flush();
    }
    if (!cur) cur = { start: w.s, end: w.e, words: [] };
    cur.words.push(entry);
    cur.end = w.e;
    if (/[.!?…]$/.test(text)) flush();
  }
  flush();

  // Estende cada linha até o início da próxima (evita "piscar"), no máximo +0.6s
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const limit = next ? next.start : lines[i].end + 0.6;
    lines[i].end = Math.min(limit, lines[i].end + 0.6);
  }
  return lines;
}

/**
 * Redistribui os tempos quando o usuário edita o texto de uma linha da legenda:
 * mantém início/fim da linha e divide proporcionalmente ao tamanho das palavras.
 */
export function retimeLine(text: string, start: number, end: number): Word[] {
  const tokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return [];
  const weights = tokens.map((t) => Math.max(2, t.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.05, end - start);
  let t = start;
  return tokens.map((w, i) => {
    const d = (weights[i] / total) * dur;
    const word = { w, s: Math.round(t * 1000) / 1000, e: Math.round((t + d) * 1000) / 1000 };
    t += d;
    return word;
  });
}
