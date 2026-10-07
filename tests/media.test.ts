import { describe, expect, it } from "vitest";
import { parseSilences, planChunks } from "../worker/media/audio";
import { buildFramingTrack, cropXExpression } from "../worker/media/framing";
import { buildFilterGraph, escapeFilterPath } from "../worker/media/render";

describe("enquadramento automático", () => {
  const segs = [{ s: 10, e: 20 }];
  it("segue o rosto principal com zona morta", () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      t: 10 + i / 3,
      faces: [[i < 15 ? 0.2 : 0.75, 0.4, 0.1, 0.18]] as [number, number, number, number][],
    }));
    const f = buildFramingTrack(samples, segs);
    expect(f.mode).toBe("face");
    expect(f.keyframes[0].x).toBeCloseTo(0.2, 2);
    expect(f.keyframes.at(-1)!.x).toBeCloseTo(0.75, 2);
    expect(f.keyframes.at(-1)!.t).toBeGreaterThan(4.5); // tempo no timeline de saída
  });

  it("sem rostos suficientes => centro", () => {
    const f = buildFramingTrack([{ t: 10, faces: [] }, { t: 11, faces: [] }], segs);
    expect(f).toEqual({ mode: "center", keyframes: [{ t: 0, x: 0.5 }] });
  });

  it("gera expressão de crop limitada ao quadro", () => {
    const expr = cropXExpression({ mode: "face", keyframes: [{ t: 0, x: 0 }, { t: 2, x: 1 }] }, 1920, 608);
    expect(expr).toBe("if(lt(t,2.00),0,if(lt(t,2.35),0+(1312)*(t-2.00)/0.35,1312))");
  });
});

describe("render", () => {
  it("monta o filtro: trechos, concat, crop 9:16, legendas e loudnorm", () => {
    const { graph, duration } = buildFilterGraph({
      source: { width: 1920, height: 1080, fps: 30 },
      clipStart: 10,
      segments: [{ s: 10, e: 14 }, { s: 15, e: 20 }],
      format: { aspect: "9:16", layout: "fill" },
      framing: { mode: "center", keyframes: [{ t: 0, x: 0.5 }] },
      assPath: "/tmp/a b/c.ass",
    });
    expect(duration).toBe(9);
    expect(graph).toContain("[vs0]trim=start=0.000:end=4.000");
    expect(graph).toContain("[vs1]trim=start=5.000:end=10.000");
    expect(graph).toContain("concat=n=2:v=1:a=1[vc][ac]");
    expect(graph).toContain("crop=w=608:h=1080:x='656':y=0,scale=1080:1920");
    expect(graph).toContain("ass=filename='/tmp/a b/c.ass'");
    expect(graph).toContain("loudnorm=I=-14");
  });

  it("layout 'fit' usa fundo desfocado", () => {
    const { graph } = buildFilterGraph({
      source: { width: 1920, height: 1080, fps: 30 },
      clipStart: 0,
      segments: [{ s: 0, e: 5 }],
      format: { aspect: "9:16", layout: "fit" },
      framing: { mode: "center", keyframes: [] },
      assPath: null,
    });
    expect(graph).toContain("boxblur");
    expect(graph).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("escapa caminhos no filtro", () => {
    expect(escapeFilterPath("C:\\x\\it's.ass")).toBe("C\\:/x/it\\'s.ass");
  });
});

describe("divisão do áudio", () => {
  it("lê a saída do silencedetect", () => {
    const out = parseSilences("[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 2.25 | silence_duration: 0.75\n");
    expect(out).toEqual([{ s: 1.5, e: 2.25 }]);
  });
  it("corta no silêncio mais próximo do alvo", () => {
    const chunks = planChunks(1500, [{ s: 590, e: 592 }, { s: 610, e: 611 }, { s: 1190, e: 1191 }]);
    expect(chunks).toEqual([{ start: 0, end: 591 }, { start: 591, end: 1190.5 }, { start: 1190.5, end: 1500 }]);
  });
});
