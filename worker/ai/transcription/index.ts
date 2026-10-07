import { env } from "../../env";
import { LocalWhisperTranscription } from "./local";
import { MockTranscription } from "./mock";
import { OpenAICompatibleTranscription } from "./openai-compatible";
import type { TranscriptionProvider } from "./types";

export type { TranscriptionProvider, TranscriptionResult } from "./types";

/**
 * Seleciona o provedor pela variável TRANSCRIPTION_PROVIDER. Todos são gratuitos:
 *   local — faster-whisper na própria máquina (open source) [padrão]
 *   groq  — API com plano gratuito (opcional; crie a chave sem cadastrar cartão)
 *   mock  — testes
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
    case "mock":
      return new MockTranscription();
    default:
      throw new Error(`TRANSCRIPTION_PROVIDER inválido: ${env.transcriptionProvider} (use local, groq ou mock)`);
  }
}
