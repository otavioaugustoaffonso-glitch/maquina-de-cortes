import { env } from "../../env";
import { MockTranscription } from "./mock";
import { OpenAICompatibleTranscription } from "./openai-compatible";
import type { TranscriptionProvider } from "./types";

export type { TranscriptionProvider, TranscriptionResult } from "./types";

/** Seleciona o provedor pela variável TRANSCRIPTION_PROVIDER. */
export function getTranscriptionProvider(): TranscriptionProvider {
  switch (env.transcriptionProvider) {
    case "openai":
      return new OpenAICompatibleTranscription(
        "openai",
        process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        process.env.OPENAI_API_KEY || "",
        process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
      );
    case "groq":
      return new OpenAICompatibleTranscription(
        "groq",
        "https://api.groq.com/openai/v1",
        process.env.GROQ_API_KEY || "",
        process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo",
      );
    case "mock":
      return new MockTranscription();
    default:
      throw new Error(`TRANSCRIPTION_PROVIDER inválido: ${env.transcriptionProvider}`);
  }
}
