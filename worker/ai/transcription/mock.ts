import fs from "node:fs/promises";
import type { TranscriptionProvider, TranscriptionResult } from "./types";

/**
 * Provedor de TESTE: lê a transcrição de um arquivo JSON (MOCK_TRANSCRIPT_PATH).
 * Permite testar o pipeline completo localmente sem gastar com APIs.
 * Nunca use em produção.
 */
export class MockTranscription implements TranscriptionProvider {
  readonly name = "mock";
  readonly model = "mock";
  readonly maxFileBytes = Number.MAX_SAFE_INTEGER;

  async transcribe(): Promise<TranscriptionResult> {
    const file = process.env.MOCK_TRANSCRIPT_PATH;
    if (!file) throw new Error("MOCK_TRANSCRIPT_PATH não definido");
    return JSON.parse(await fs.readFile(file, "utf8")) as TranscriptionResult;
  }
}
