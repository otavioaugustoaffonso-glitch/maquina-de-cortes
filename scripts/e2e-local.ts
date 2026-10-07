/**
 * Teste de ponta a ponta do PIPELINE DE MÍDIA, sem Supabase e sem custo de API:
 *   vídeo -> áudio -> divisão em silêncios -> transcrição (mock) -> análise
 *   -> pontuação/ordenação -> remoção de pausas -> enquadramento -> legendas ASS
 *   -> render 1080x1920 H.264/AAC -> thumbnail -> zip.
 *
 *   npm run test:e2e

 */
import { ZipArchive } from "archiver";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { formatTranscriptForPrompt, mergeChunkTranscripts, punctuateWordsFromSegments } from "@/lib/ai/transcript";
import { buildAss } from "@/lib/captions/ass";
import { CAPTION_PRESETS } from "@/lib/captions/styles";
import { finalizeCandidates, targetClipCount } from "@/lib/clips/candidates";
import { computeKeepSegments, remapWords } from "@/lib/clips/timing";
import type { Segment, Word } from "@/lib/types";
import { HeuristicAnalyzer } from "../worker/ai/analysis/heuristic";
import { cutAudio, detectSilences, extractAudio, makeProxy, planChunks } from "../worker/media/audio";
import { ffmpeg, probe } from "../worker/media/ffmpeg";
import { computeFraming } from "../worker/media/framing";
import { makeThumbnail, renderClip } from "../worker/media/render";

const SENTENCES = [
  "Bom, pessoal, então, hoje eu queria conversar com vocês sobre dinheiro.",
  "Você está perdendo dinheiro todos os meses sem perceber.",
  "E o motivo é muito simples: ninguém te ensinou a olhar para as pequenas assinaturas.",
  "Eu descobri isso quando abri a minha fatura e vi doze serviços que eu nem usava.",
  "Sabe quanto dava isso por ano? Quase quatro mil reais!",
  "Então a primeira dica é: liste todas as cobranças recorrentes do seu cartão.",
  "A segunda dica é cancelar tudo que você não usou nos últimos trinta dias.",
  "Parece óbvio, mas a maioria das pessoas nunca faz isso.",
  "Agora, a pergunta que todo mundo me faz: vale a pena investir com pouco dinheiro?",
  "Vale sim, e eu vou te provar com um exemplo real.",
  "Com cem reais por mês, em dez anos, você pode ter mais de vinte mil reais guardados.",
  "O segredo não é quanto você ganha, é quanto você consegue manter.",
  "Esse foi o maior erro da minha vida financeira e eu demorei anos para entender.",
  "Hoje eu sigo uma regra que mudou tudo: pague a você mesmo primeiro.",
  "Assim que o salário cai, uma parte vai direto para o investimento.",
  "Pronto, é isso, se gostou compartilha com alguém que precisa ouvir isso.",
];

function buildTranscript(): { words: Word[]; segments: Segment[]; text: string } {
  const words: Word[] = [];
  const segments: Segment[] = [];
  let t = 1.0;
  SENTENCES.forEach((sentence, i) => {
    const s0 = t;
    for (const w of sentence.split(" ")) {
      const d = 0.18 + w.length * 0.035;
      words.push({ w, s: +t.toFixed(3), e: +(t + d).toFixed(3) });
      t += d + 0.06;
    }
    segments.push({ s: +s0.toFixed(3), e: +(t - 0.06).toFixed(3), t: sentence });
    t += i % 4 === 3 ? 2.2 : 0.45; // pausas longas de vez em quando
  });
  return { words, segments, text: SENTENCES.join(" ") };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mc-e2e-"));
  console.log(`Diretório de trabalho: ${dir}`);
  const transcriptData = buildTranscript();
  const duration = Math.ceil(transcriptData.words[transcriptData.words.length - 1].e + 2);

  // 1. Vídeo sintético 1920x1080 com "fala" (tom) apenas onde há palavras
  console.log("\n1. Gerando vídeo de teste...");
  const source = path.join(dir, "source.mov");
  const enable = transcriptData.segments.map((s) => `between(t,${s.s},${s.e})`).join("+");
  await ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=size=1920x1080:rate=30:duration=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000:duration=${duration}`,
    "-af", `volume='if(${enable},1,0)':eval=frame`,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source,
  ]);
  const info = await probe(source);
  assert(info.hasVideo && info.hasAudio && Math.abs(info.duration - duration) < 1, `probe: ${info.width}x${info.height}, ${info.duration.toFixed(1)}s`);

  // 2. Áudio + proxy
  console.log("\n2. Extraindo áudio e gerando proxy...");
  const audio = path.join(dir, "audio.mp3");
  await extractAudio(source, audio);
  const proxy = path.join(dir, "proxy.mp4");
  await makeProxy(source, proxy);
  const pinfo = await probe(proxy);
  assert(pinfo.height === 540, "proxy 540p gerado");
  const audioInfo = await probe(audio);
  assert(!audioInfo.hasVideo && audioInfo.hasAudio, `áudio extraído (${(fs.statSync(audio).size / 1024).toFixed(0)} KB)`);

  // 3. Divisão em pedaços nos silêncios (alvo pequeno só para exercitar o código)
  console.log("\n3. Planejando divisão do áudio em silêncios...");
  const silences = await detectSilences(audio);
  assert(silences.length > 0, `${silences.length} silêncios detectados`);
  const chunks = planChunks(info.duration, silences, 40, 10);
  assert(chunks.length > 1 && chunks[chunks.length - 1].end === Math.round(info.duration * 1000) / 1000, `${chunks.length} pedaços`);
  for (const [i, c] of chunks.entries()) {
    const inSilence = i === 0 || silences.some((s) => c.start >= s.s - 0.01 && c.start <= s.e + 0.01);
    assert(inSilence, `pedaço ${i} começa em ${c.start.toFixed(2)}s (dentro de um silêncio)`);
    await cutAudio(audio, path.join(dir, `chunk-${i}.mp3`), c.start, c.end);
  }

  // 4. "Transcrição" (mock): simula pedaços com tempos relativos e junta com offset
  console.log("\n4. Transcrição (mock) + junção dos pedaços...");
  const chunked = chunks.map((c) => ({
    offset: c.start,
    words: transcriptData.words.filter((w) => w.s >= c.start && w.s < c.end).map((w) => ({ w: w.w.replace(/[.,!?:]/g, ""), s: w.s - c.start, e: w.e - c.start })),
    segments: transcriptData.segments.filter((s) => s.s >= c.start && s.s < c.end).map((s) => ({ ...s, s: s.s - c.start, e: s.e - c.start })),
    text: "",
  }));
  const merged = mergeChunkTranscripts(chunked.map((c) => ({ ...c, words: punctuateWordsFromSegments(c.words, c.segments) })));
  assert(merged.words.length === transcriptData.words.length, `${merged.words.length} palavras com timestamps`);
  assert(merged.words.filter((w) => /[.!?]$/.test(w.w)).length >= SENTENCES.length - 1, "pontuação reaplicada às palavras");

  // 5. Análise
  console.log("\n5. Analisando transcrição...");
  const analyzer = new HeuristicAnalyzer();
  const prompt = formatTranscriptForPrompt(merged.segments);
  const result = await analyzer.analyze({ transcript: prompt, durationSeconds: info.duration, language: "pt", clipCount: targetClipCount(info.duration), projectName: "E2E" });
  assert(result.clips.length > 0, `${analyzer.name}: ${result.clips.length} candidatos`);
  const clips = finalizeCandidates(result.clips, merged.words, info.duration);
  assert(clips.length > 0, `${clips.length} cortes finais após pós-processamento`);
  for (const c of clips) {
    console.log(`     #${c.rank} [${c.start.toFixed(1)}-${c.end.toFixed(1)}] ${c.score}/100 (${c.retentionPotential}) — ${c.title}`);
    assert(c.end - c.start >= 8, `corte #${c.rank} tem duração válida`);
  }
  for (let i = 1; i < clips.length; i++) assert(clips[i - 1].score >= clips[i].score, `ordenado por score (#${i})`);
  assert(!clips.some((c) => /^bom\b/i.test(merged.words.find((w) => w.s >= c.start)?.w ?? "")), "nenhum corte começa com introdução vazia");

  // 6. Render dos 2 melhores (estilos diferentes)
  console.log("\n6. Renderizando cortes...");
  const outputs: string[] = [];
  for (const [i, c] of clips.slice(0, 2).entries()) {
    const segments = computeKeepSegments(merged.words, c.start, c.end);
    const outWords = remapWords(merged.words.filter((w) => w.e > c.start && w.s < c.end), segments);
    const outDur = segments.reduce((a, s) => a + s.e - s.s, 0);
    const preset = i === 0 ? "viral" : "podcast";
    const ass = path.join(dir, `clip-${i}.ass`);
    await fsp.writeFile(ass, buildAss({ words: outWords, style: CAPTION_PRESETS[preset].style, width: 1080, height: 1920, duration: outDur, keywords: c.keywords, title: c.title_on_screen }));
    const framing = await computeFraming(proxy, segments[0].s, segments[segments.length - 1].e, segments);
    const out = path.join(dir, `clip-${i}.mp4`);
    const t0 = Date.now();
    await renderClip({ input: source, source: info, clipStart: c.start, segments, format: { aspect: "9:16", layout: i === 0 ? "fill" : "fit" }, framing, assPath: ass, output: out });
    const o = await probe(out);
    assert(o.width === 1080 && o.height === 1920 && o.videoCodec === "h264" && o.hasAudio, `corte ${i + 1}: 1080x1920 H.264 + AAC (${preset}, ${Date.now() - t0}ms)`);
    assert(Math.abs(o.duration - outDur) < 0.25, `corte ${i + 1}: duração ${o.duration.toFixed(2)}s ≈ ${outDur.toFixed(2)}s (pausas removidas: ${(c.end - c.start - outDur).toFixed(2)}s)`);
    const thumb = out.replace(".mp4", ".jpg");
    await makeThumbnail(out, thumb);
    assert(fs.statSync(thumb).size > 5000, `corte ${i + 1}: thumbnail gerada`);
    outputs.push(out, thumb);
  }

  // 7. Zip (como no export)
  console.log("\n7. Gerando pacote .zip...");
  const zip = path.join(dir, "cortes.zip");
  const archive = new ZipArchive({ store: true });
  const done = pipeline(archive, fs.createWriteStream(zip));
  for (const f of outputs) archive.file(f, { name: path.basename(f) });
  archive.append("legendas", { name: "legendas-e-hashtags.txt" });
  await archive.finalize();
  await done;
  assert(fs.statSync(zip).size > outputs.reduce((a, f) => a + fs.statSync(f).size, 0), "zip contém todos os arquivos");

  console.log(`\n✅ Pipeline completo OK. Arquivos em ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
