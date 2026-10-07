import { env } from "../../env";
import { assertPaidAllowed } from "../paid-guard";
import { LocalWhisperTranscription } from "./local";
import { MockTranscription } from "./mock";
import { OpenAICompatibleTranscription } from "./openai-compatible";
import type { TranscriptionProvider } from "./types";

export type { TranscriptionProvider, TranscriptionResult } from "./types";

/**
 * Seleciona o provedor pela variável TRANSCRIPTION_PROVIDER:
 *   local  — faster-whisper na própria máquina (gratuito, open source) [padrão]
 *   groq   — API com plano gratuito (Whisper large v3 turbo)
 *   openai — API paga (exige ALLOW_PAID_PROVIDERS=true)
 *   mock   — testes
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  switch (env.transcriptionProvider) {
    case "local":
      return new LocalWhisperTranscription();
    case "groq":
      return new OpenAICompatibleTranscription(
        "groq",
        "https://api.groq.com/openai/v1",
        process.env.GROQ_API_KEY || "",
        process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo",
      );
    case "openai":
      assertPaidAllowed("openai");
      return new OpenAICompatibleTranscription(
        "openai",
        process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        process.env.OPENAI_API_KEY || "",
        process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
      );
    case "mock":
      return new MockTranscription();
    default:
      throw new Error(`TRANSCRIPTION_PROVIDER inválido: ${env.transcriptionProvider}`);
  }
}
