import type { Segment, Word } from "../types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Constrói segmentos (frases) a partir das palavras quando o provedor não os fornece. */
export function wordsToSegments(words: Word[], maxSeconds = 12): Segment[] {
  const segs: Segment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({ s: cur[0].s, e: cur[cur.length - 1].e, t: cur.map((w) => w.w).join(" ") });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length && (w.s - cur[cur.length - 1].e > 1.0 || w.e - cur[0].s > maxSeconds)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  return segs;
}

/**
 * Formato compacto enviado ao LLM: uma linha por frase com tempo de início e fim.
 *   [12.4-18.9] Você está perdendo dinheiro todos os meses sem perceber.
 * Só o TEXTO vai para a IA — nunca o vídeo/áudio — o que mantém o custo baixo.
 */
export function formatTranscriptForPrompt(segments: Segment[]): string {
  return segments.map((s) => `[${r2(s.s).toFixed(1)}-${r2(s.e).toFixed(1)}] ${s.t.trim()}`).join("\n");
}

/**
 * Divide transcrições muito longas em janelas (com sobreposição) para caber
 * confortavelmente no contexto do modelo. Vídeos de até ~4h cabem em uma única janela.
 */
export function splitTranscriptWindows(segments: Segment[], maxChars = 400_000, overlapSeconds = 120): Segment[][] {
  const total = segments.reduce((a, s) => a + s.t.length + 16, 0);
  if (total <= maxChars) return [segments];
  const windows: Segment[][] = [];
  let i = 0;
  while (i < segments.length) {
    const win: Segment[] = [];
    let chars = 0;
    let j = i;
    while (j < segments.length && chars + segments[j].t.length + 16 <= maxChars) {
      chars += segments[j].t.length + 16;
      win.push(segments[j]);
      j++;
    }
    if (win.length === 0) {
      win.push(segments[j]);
      j++;
    }
    windows.push(win);
    if (j >= segments.length) break;
    // próxima janela começa `overlapSeconds` antes do fim desta
    const cutoff = win[win.length - 1].e - overlapSeconds;
    let k = j;
    while (k > i + 1 && segments[k - 1].s > cutoff) k--;
    i = Math.max(i + 1, k);
  }
  return windows;
}

/** Junta transcrições de pedaços de áudio, aplicando o deslocamento de tempo de cada pedaço. */
export function mergeChunkTranscripts(chunks: { offset: number; words: Word[]; segments: Segment[]; text: string }[]): {
  words: Word[];
  segments: Segment[];
  text: string;
} {
  const words: Word[] = [];
  const segments: Segment[] = [];
  const texts: string[] = [];
  for (const c of chunks) {
    const lastEnd = words.length ? words[words.length - 1].e : -1;
    for (const w of c.words) {
      const s = r3(w.s + c.offset);
      const e = r3(w.e + c.offset);
      if (s < lastEnd - 0.05) continue; // evita duplicar palavras na fronteira
      words.push({ w: w.w, s, e });
    }
    for (const sg of c.segments) segments.push({ s: r3(sg.s + c.offset), e: r3(sg.e + c.offset), t: sg.t });
    texts.push(c.text.trim());
  }
  return { words, segments, text: texts.join(" ") };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Whisper retorna palavras sem pontuação no modo word-level em alguns provedores.
 * Reaplica a pontuação dos segmentos às palavras (melhora quebras de legenda e métricas).
 */
export function punctuateWordsFromSegments(words: Word[], segments: Segment[]): Word[] {
  if (words.some((w) => /[.,!?…]$/.test(w.w))) return words;
  const out = words.map((w) => ({ ...w }));
  let wi = 0;
  for (const seg of segments) {
    const tokens = seg.t.trim().split(/\s+/).filter(Boolean);
    // alinha pelos tempos: palavras cujo início está dentro do segmento
    const idx: number[] = [];
    while (wi < out.length && out[wi].s < seg.e - 0.01) {
      if (out[wi].s >= seg.s - 0.3) idx.push(wi);
      wi++;
    }
    if (idx.length === tokens.length) {
      idx.forEach((k, n) => (out[k].w = tokens[n]));
    } else if (idx.length) {
      const last = tokens[tokens.length - 1] ?? "";
      const punct = last.match(/[.,!?…]+$/)?.[0];
      if (punct) out[idx[idx.length - 1]].w += punct;
    }
  }
  return out;
}
