import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../env";
import { run } from "../../media/ffmpeg";
import type { TranscriptionProvider, TranscriptionResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Transcrição local GRATUITA (faster-whisper, open source) — sem API, sem custo por minuto.
 * Mais lenta que as APIs em CPU; ideal para desenvolvimento/MVP de custo zero.
 */
export class LocalWhisperTranscription implements TranscriptionProvider {
  readonly name = "local";
  readonly model = process.env.LOCAL_WHISPER_MODEL || "small";
  /** Sem limite de tamanho: o arquivo inteiro é processado localmente, sem divisão. */
  readonly maxFileBytes = Number.MAX_SAFE_INTEGER;

  async transcribe(filePath: string, opts: { language?: string | null }): Promise<TranscriptionResult> {
    const { stdout } = await run(env.pythonBin, [path.join(here, "local_whisper.py"), filePath, opts.language ?? "auto"], {
      timeoutMs: 6 * 60 * 60 * 1000,
    });
    const data = JSON.parse(stdout) as TranscriptionResult;
    return {
      text: data.text ?? "",
      language: data.language ?? null,
      words: data.words ?? [],
      segments: data.segments ?? [],
      duration: data.duration ?? null,
    };
  }
}
