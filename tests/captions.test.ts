import { describe, expect, it } from "vitest";
import { assColor, assTime, buildAss } from "@/lib/captions/ass";
import { groupCaptionLines, retimeLine } from "@/lib/captions/grouping";
import { CAPTION_PRESETS, resolveCaptionStyle } from "@/lib/captions/styles";
import type { Word } from "@/lib/types";

const words: Word[] = "Você está perdendo dinheiro todos os meses sem perceber. Isso muda tudo."
  .split(" ")
  .map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.35 }));

describe("legendas", () => {
  it("converte cores e tempos para ASS", () => {
    expect(assColor("#FACC15")).toBe("&H0015CCFA");
    expect(assColor("#000000", 0.5)).toBe("&H80000000");
    expect(assTime(3725.456)).toBe("1:02:05.46");
  });

  it("agrupa palavras respeitando limite e pontuação", () => {
    const lines = groupCaptionLines(words, { wordsPerLine: 3, fontSize: 76 }, ["dinheiro"]);
    expect(lines.map((l) => l.words.map((w) => w.w).join(" "))).toEqual([
      "Você está perdendo", "dinheiro todos os", "meses sem perceber.", "Isso muda tudo.",
    ]);
    expect(lines[1].words[0].keyword).toBe(true);
    for (let i = 1; i < lines.length; i++) expect(lines[i - 1].end).toBeLessThanOrEqual(lines[i].start + 1e-9);
  });

  it("gera ASS com destaque palavra a palavra e título", () => {
    const ass = buildAss({
      words, style: CAPTION_PRESETS.viral.style, width: 1080, height: 1920, duration: 6,
      keywords: ["dinheiro"], title: "O erro {financeiro}",
    });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Style: Caption,Anton,104,");
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:04.50,Title,,0,0,0,,{\\fad(150,250)}O erro financeiro");
    expect(ass).toContain("VOCÊ");
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue: 0"));
    expect(dialogues.length).toBe(words.length); // 1 evento por palavra
  });

  it("valida estilos vindos do cliente", () => {
    const s = resolveCaptionStyle({ preset: "podcast", fontSize: 9999, color: "red", font: "Comic Sans", position: "top" });
    expect(s.fontSize).toBe(160);
    expect(s.color).toBe(CAPTION_PRESETS.podcast.style.color);
    expect(s.font).toBe("Poppins");
    expect(s.position).toBe("top");
  });

  it("redistribui tempos de uma linha editada", () => {
    const out = retimeLine("Texto corrigido aqui", 1, 2.5);
    expect(out).toHaveLength(3);
    expect(out[0].s).toBe(1);
    expect(out[2].e).toBeCloseTo(2.5, 3);
  });
});
