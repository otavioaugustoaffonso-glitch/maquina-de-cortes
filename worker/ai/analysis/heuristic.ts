import type { RawClipCandidate } from "@/lib/types";
import type { AnalysisInput, AnalysisResult, ClipAnalyzer } from "./types";

/**
 * Analisador GRATUITO baseado em regras (sem LLM).
 * Qualidade bem inferior à IA — útil para desenvolvimento, testes ou como
 * alternativa de custo zero. Ative com ANALYSIS_PROVIDER=heuristic.
 */
const HOOK_TERMS = [
  "você", "voce", "segredo", "erro", "erros", "nunca", "sempre", "ninguém", "verdade", "dica", "importante",
  "dinheiro", "problema", "maior", "melhor", "pior", "cuidado", "atenção", "descobri", "história", "aconteceu",
  "por que", "porque", "como", "jeito", "passo", "mentira", "polêmica", "incrível", "absurdo",
  "you", "secret", "mistake", "never", "always", "truth", "tip", "money", "why", "how",
];

type Line = { s: number; e: number; t: string };

function parseLines(transcript: string): Line[] {
  return transcript
    .split("\n")
    .map((l) => l.match(/^\[([\d.]+)-([\d.]+)\]\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ s: Number(m[1]), e: Number(m[2]), t: m[3] }));
}

function features(text: string) {
  const lower = text.toLowerCase();
  const hits = HOOK_TERMS.filter((t) => lower.includes(t)).length;
  return {
    hits,
    questions: (text.match(/\?/g) ?? []).length,
    exclamations: (text.match(/!/g) ?? []).length,
    numbers: (text.match(/\d+/g) ?? []).length,
  };
}

export class HeuristicAnalyzer implements ClipAnalyzer {
  readonly name = "heuristic";
  readonly model = "rules-v1";

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const lines = parseLines(input.transcript);
    const candidates: RawClipCandidate[] = [];
    const targets = [25, 45, 75];
    for (let i = 0; i < lines.length; i++) {
      for (const target of targets) {
        let j = i;
        while (j + 1 < lines.length && lines[j].e - lines[i].s < target) j++;
        const dur = lines[j].e - lines[i].s;
        if (dur < 12 || dur > 180) continue;
        const text = lines.slice(i, j + 1).map((l) => l.t).join(" ");
        const first = features(lines[i].t);
        const all = features(text);
        const hook = Math.min(10, 3 + first.hits * 1.5 + first.questions * 2 + first.exclamations);
        const density = Math.min(10, 3 + (all.hits / Math.max(1, dur / 15)) * 1.2 + all.numbers * 0.4);
        const words = text.split(/\s+/).filter(Boolean);
        candidates.push({
          start: lines[i].s,
          end: lines[j].e,
          title: lines[i].t.split(/[.!?]/)[0].slice(0, 70) || "Trecho em destaque",
          title_on_screen: lines[i].t.split(/[.!?]/)[0].slice(0, 45),
          description: text.slice(0, 180),
          hook: lines[i].t.slice(0, 200),
          reason: "Selecionado automaticamente por regras (palavras de impacto, perguntas e densidade de informação).",
          category: first.questions ? "pergunta_resposta" : "frase_forte",
          keywords: [...new Set(words.filter((w) => w.length > 6).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")))].slice(0, 5),
          hashtags: ["#cortes", "#shorts", "#reels"],
          social_caption: `${lines[i].t.slice(0, 120)} 👀 Siga para mais!`,
          scores: { hook, clarity: 6, value: density, emotion: Math.min(10, 4 + all.exclamations), curiosity: Math.min(10, 4 + all.questions * 1.5), standalone: 5 },
        });
      }
    }
    candidates.sort((a, b) => b.scores.hook + b.scores.value - (a.scores.hook + a.scores.value));
    return { clips: candidates.slice(0, input.clipCount.max * 3), usage: { inputTokens: 0, outputTokens: 0 }, model: this.model };
  }
}
