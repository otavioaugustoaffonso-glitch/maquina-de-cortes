/**
 * Teste rápido do renderizador sem Supabase:
 *   npx tsx scripts/dev-render-test.ts <video> <saida-dir>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { buildAss } from "@/lib/captions/ass";
import { CAPTION_PRESETS } from "@/lib/captions/styles";
import { computeKeepSegments, remapWords } from "@/lib/clips/timing";
import type { Word } from "@/lib/types";
import { probe } from "../worker/media/ffmpeg";
import { makeThumbnail, renderClip } from "../worker/media/render";

const [input, outDir] = process.argv.slice(2);
await fs.mkdir(outDir, { recursive: true });
const info = await probe(input);
// palavras sintéticas com uma pausa longa entre 8s e 12s
const words: Word[] = [];
"Você está perdendo dinheiro todos os meses sem perceber e isso muda tudo quando você entende".split(" ").forEach((w, i) => {
  const s = 2 + i * 0.4 + (i >= 15 ? 4 : 0);
  words.push({ w, s, e: s + 0.35 });
});
const start = 2, end = 15;
const segments = computeKeepSegments(words, start, end);
const outWords = remapWords(words, segments);
for (const [preset, layout] of [["viral", "fill"], ["podcast", "fit"]] as const) {
  const duration = segments.reduce((a, s) => a + s.e - s.s, 0);
  const assPath = path.join(outDir, `${preset}.ass`);
  await fs.writeFile(assPath, buildAss({ words: outWords, style: CAPTION_PRESETS[preset].style, width: 1080, height: 1920, duration, keywords: ["dinheiro"], title: "O erro que te deixa pobre" }));
  const out = path.join(outDir, `${preset}-${layout}.mp4`);
  const t0 = Date.now();
  await renderClip({
    input, source: info, clipStart: start, segments, format: { aspect: "9:16", layout },
    framing: { mode: "face", keyframes: [{ t: 0, x: 0.3 }, { t: 3, x: 0.7 }] }, assPath, output: out,
    onProgress: (f) => process.stdout.write(`\r${preset} ${(f * 100).toFixed(0)}%   `),
  });
  await makeThumbnail(out, out.replace(".mp4", ".jpg"));
  console.log(`\n${out} em ${Date.now() - t0}ms`, await probe(out));
}
