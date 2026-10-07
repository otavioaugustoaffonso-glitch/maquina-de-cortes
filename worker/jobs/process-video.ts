import fs from "node:fs/promises";
import path from "node:path";
import { formatTranscriptForPrompt, mergeChunkTranscripts, punctuateWordsFromSegments, splitTranscriptWindows, wordsToSegments } from "@/lib/ai/transcript";
import { DEFAULT_CAPTION_STYLE, resolveCaptionStyle } from "@/lib/captions/styles";
import { finalizeCandidates, targetClipCount } from "@/lib/clips/candidates";
import { BUCKETS } from "@/lib/constants";
import type { RawClipCandidate, Segment, Word } from "@/lib/types";
import { getClipAnalyzer } from "../ai/analysis";
import { getTranscriptionProvider } from "../ai/transcription";
import { env } from "../env";
import { log } from "../log";
import { cutAudio, detectSilences, extractAudio, makeProxy, planChunks } from "../media/audio";
import { probe } from "../media/ffmpeg";
import { enqueue, PermanentError, type Job } from "../queue";
import { uploadFile } from "../storage";
import { db, must } from "../supabase";
import { ensureSourceLocal, getVideo, recordUsage, setVideoStatus, videoWorkDir, type VideoRow } from "./common";

type TranscriptRow = { words: Word[]; segments: Segment[]; language: string | null; text: string };

/**
 * Pipeline principal (pensado para economizar chamadas de IA):
 *   vídeo -> áudio -> transcrição (1x) -> análise do TEXTO (1x) -> cortes
 *   -> renderização apenas dos cortes selecionados (jobs separados, em paralelo).
 * Em caso de retry, etapas pagas já concluídas (transcrição/análise) são reaproveitadas.
 */
export async function processVideo(job: Job, beat: () => Promise<void>): Promise<void> {
  const videoId = String(job.payload.videoId);
  const video = await getVideo(videoId);
  if (video.status === "completed") return;

  await setVideoStatus(videoId, "extracting_audio", 3, {
    processing_started_at: new Date().toISOString(),
    error: null,
    status_message: null,
  });

  // 1. Original em disco + validação real do conteúdo (ffprobe)
  const source = await ensureSourceLocal(video);
  const info = await probe(source);
  if (!info.hasVideo) throw new PermanentError("O arquivo enviado não contém uma trilha de vídeo válida.");
  if (!info.hasAudio) throw new PermanentError("O vídeo não possui áudio — não é possível transcrever.");
  if (info.duration < 5) throw new PermanentError("O vídeo é curto demais (mínimo de 5 segundos).");
  if (info.duration > env.maxVideoSeconds) {
    throw new PermanentError(`O vídeo excede a duração máxima de ${Math.round(env.maxVideoSeconds / 60)} minutos.`);
  }
  await must(
    db().from("videos").update({ duration_seconds: info.duration, width: info.width, height: info.height, fps: info.fps }).eq("id", videoId),
    "salvar metadados",
  );

  const dir = videoWorkDir(videoId);
  await fs.mkdir(dir, { recursive: true });

  // 2. Proxy de preview em paralelo (não bloqueia transcrição/análise)
  const proxyPromise = env.proxyEnabled && !video.proxy_path ? buildProxy(video, source, info.duration) : Promise.resolve();

  // 3. Áudio + transcrição (reaproveita se já existir)
  let transcript = await loadTranscript(videoId);
  if (!transcript) {
    // Créditos são debitados uma única vez (antes da primeira transcrição)
    if (env.enforceCredits) await checkCredits(video.user_id, videoId, info.duration);
    const audio = path.join(dir, "audio.mp3");
    await extractAudio(source, audio, (f) => void setVideoStatus(videoId, "extracting_audio", 3 + f * 9).catch(() => {}), info.duration);
    await beat();
    transcript = await transcribe(video, audio, info.duration, beat);
  } else {
    log.info("transcrição existente reaproveitada", { videoId });
  }
  if (transcript.words.length < 20) {
    throw new PermanentError("Não foi detectada fala suficiente no vídeo para gerar cortes.");
  }

  // 4. Análise (reaproveita cortes já gerados em tentativas anteriores)
  const { count: existing } = await db().from("clips").select("id", { count: "exact", head: true }).eq("video_id", videoId);
  if (!existing) {
    await setVideoStatus(videoId, "analyzing", 45);
    const raw = await analyze(video, transcript, info.duration, beat);

    await setVideoStatus(videoId, "finding_moments", 65);
    const project = await must(db().from("projects").select("name, settings").eq("id", video.project_id).single(), "carregar projeto") as {
      settings: { captionStyle?: unknown; format?: unknown } | null;
    };
    const captionStyle = resolveCaptionStyle(project.settings?.captionStyle ?? DEFAULT_CAPTION_STYLE);
    const format = normalizeFormat(project.settings?.format);
    const clips = finalizeCandidates(raw, transcript.words, info.duration);
    if (clips.length === 0) {
      await setVideoStatus(videoId, "completed", 100, {
        status_message: "Nenhum trecho com potencial suficiente foi encontrado neste vídeo.",
        processing_finished_at: new Date().toISOString(),
      });
      return;
    }
    await must(
      db().from("clips").insert(
        clips.map((c) => ({
          project_id: video.project_id,
          video_id: videoId,
          user_id: video.user_id,
          rank: c.rank,
          status: c.rank <= env.maxAutoRender ? "queued" : "suggested",
          start_time: c.start,
          end_time: c.end,
          title: c.title,
          description: c.description,
          hook: c.hook,
          reason: c.reason,
          category: c.category,
          retention_potential: c.retentionPotential,
          keywords: c.keywords,
          hashtags: c.hashtags,
          social_caption: c.social_caption,
          title_on_screen: c.title_on_screen,
          score: c.score,
          score_breakdown: c.breakdown,
          caption_style: captionStyle,
          format,
        })),
      ),
      "salvar cortes",
    );
  }

  // 5. Garante o proxy antes de renderizar (usado na detecção de rosto e no preview)
  await proxyPromise;

  // 6. Enfileira a renderização dos cortes (paralelizável entre vários workers)
  await setVideoStatus(videoId, "generating_clips", 70);
  const queued = (await must(
    db().from("clips").select("id").eq("video_id", videoId).eq("status", "queued").order("rank"),
    "listar cortes",
  )) as { id: string }[];
  for (const c of queued) {
    await enqueue("render_clip", { clipId: c.id, videoId }, { userId: video.user_id, priority: 50 });
  }
  if (queued.length === 0) {
    await setVideoStatus(videoId, "completed", 100, { processing_finished_at: new Date().toISOString() });
  }
}

async function checkCredits(userId: string, videoId: string, duration: number) {
  // idempotente: um retry não debita duas vezes
  const { count } = await db().from("usage_events").select("id", { count: "exact", head: true })
    .eq("video_id", videoId).eq("kind", "credits_debit");
  if (count) return;
  const profile = (await must(db().from("profiles").select("credits_seconds").eq("id", userId).single(), "carregar créditos")) as {
    credits_seconds: number;
  };
  if (profile.credits_seconds < duration) {
    throw new PermanentError("Créditos de processamento insuficientes para este vídeo.");
  }
  await must(
    db().from("profiles").update({ credits_seconds: profile.credits_seconds - Math.ceil(duration) }).eq("id", userId),
    "debitar créditos",
  );
  await recordUsage(userId, videoId, "credits_debit", Math.ceil(duration));
}

function normalizeFormat(input: unknown) {
  const f = (input && typeof input === "object" ? input : {}) as { aspect?: string; layout?: string };
  return {
    aspect: ["9:16", "1:1", "4:5", "16:9"].includes(f.aspect ?? "") ? f.aspect : "9:16",
    layout: f.layout === "fit" ? "fit" : "fill",
  };
}

async function buildProxy(video: VideoRow, source: string, duration: number) {
  const file = path.join(videoWorkDir(video.id), "proxy.mp4");
  try {
    await makeProxy(source, file, undefined, duration);
    const objectPath = `${video.user_id}/${video.project_id}/${video.id}/proxy.mp4`;
    await uploadFile(BUCKETS.videos, objectPath, file, "video/mp4");
    await db().from("videos").update({ proxy_path: objectPath }).eq("id", video.id);
    video.proxy_path = objectPath;
  } catch (e) {
    // O proxy é opcional: sem ele, o preview usa o original e o tracking usa o original.
    log.warn("falha ao gerar proxy", { videoId: video.id, error: String(e) });
  }
}

async function loadTranscript(videoId: string): Promise<TranscriptRow | null> {
  const { data } = await db().from("transcripts").select("words, segments, language, text").eq("video_id", videoId).maybeSingle();
  return (data as TranscriptRow | null) ?? null;
}

async function transcribe(video: VideoRow, audio: string, duration: number, beat: () => Promise<void>): Promise<TranscriptRow> {
  const provider = getTranscriptionProvider();
  await setVideoStatus(video.id, "transcribing", 12);

  const { size } = await fs.stat(audio);
  let chunks = [{ start: 0, end: duration }];
  if (size > provider.maxFileBytes * 0.9) {
    // Divide no meio de silêncios (~10 min por pedaço, ~2.4 MB cada)
    chunks = planChunks(duration, await detectSilences(audio));
  }
  const project = (await must(db().from("projects").select("settings").eq("id", video.project_id).single(), "carregar projeto")) as {
    settings: { language?: string } | null;
  };
  const language = project.settings?.language && project.settings.language !== "auto" ? project.settings.language : null;

  const results = [];
  let detectedLanguage: string | null = language;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const file = chunks.length === 1 ? audio : path.join(path.dirname(audio), `chunk-${i}.mp3`);
    if (chunks.length > 1) await cutAudio(audio, file, c.start, c.end);
    const r = await provider.transcribe(file, { language: detectedLanguage });
    detectedLanguage = detectedLanguage ?? r.language;
    const segments = r.segments.length ? r.segments : wordsToSegments(r.words);
    results.push({ offset: c.start, words: punctuateWordsFromSegments(r.words, segments), segments, text: r.text });
    await setVideoStatus(video.id, "transcribing", 12 + ((i + 1) / chunks.length) * 30);
    await beat();
  }
  const merged = mergeChunkTranscripts(results);
  const row: TranscriptRow = { ...merged, language: detectedLanguage };

  await must(
    db().from("transcripts").upsert(
      {
        video_id: video.id,
        user_id: video.user_id,
        provider: provider.name,
        model: provider.model,
        language: detectedLanguage,
        text: merged.text,
        segments: merged.segments,
        words: merged.words,
        duration_seconds: duration,
      },
      { onConflict: "video_id" },
    ),
    "salvar transcrição",
  );
  await recordUsage(video.user_id, video.id, "transcription_seconds", Math.ceil(duration), provider.name, { model: provider.model, chunks: chunks.length });
  return row;
}

async function analyze(video: VideoRow, t: TranscriptRow, duration: number, beat: () => Promise<void>): Promise<RawClipCandidate[]> {
  const analyzer = getClipAnalyzer();
  const project = (await must(db().from("projects").select("name").eq("id", video.project_id).single(), "carregar projeto")) as { name: string };
  const segments = t.segments.length ? t.segments : wordsToSegments(t.words);
  const windows = splitTranscriptWindows(segments);
  const all: RawClipCandidate[] = [];
  const total = targetClipCount(duration);

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const start = w[0].s;
    const end = w[w.length - 1].e;
    const share = (end - start) / duration;
    const res = await analyzer.analyze({
      transcript: formatTranscriptForPrompt(w),
      durationSeconds: duration,
      language: t.language,
      projectName: project.name,
      clipCount: {
        min: Math.max(1, Math.round(total.min * share)),
        max: Math.max(2, Math.round(total.max * share)),
      },
      window: windows.length > 1 ? { start, end, index: i, total: windows.length } : undefined,
    });
    all.push(...res.clips);
    if (res.usage.inputTokens || res.usage.outputTokens) {
      await recordUsage(video.user_id, video.id, "llm_input_tokens", res.usage.inputTokens, analyzer.name, { model: res.model });
      await recordUsage(video.user_id, video.id, "llm_output_tokens", res.usage.outputTokens, analyzer.name, { model: res.model });
    }
    await setVideoStatus(video.id, "analyzing", 45 + ((i + 1) / windows.length) * 18);
    await beat();
  }
  return all;
}
