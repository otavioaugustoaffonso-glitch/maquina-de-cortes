import type { Segment, Word } from "@/lib/types";

export type TranscriptionResult = {
  text: string;
  language: string | null;
  words: Word[];
  segments: Segment[];
  duration: number | null;
};

/**
 * Contrato de um provedor de transcrição. Para trocar de provedor, implemente
 * esta interface e registre em ./index.ts — o resto do pipeline não muda.
 */
export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;
  /** Tamanho máximo de arquivo aceito pela API (bytes). */
  readonly maxFileBytes: number;
  transcribe(filePath: string, opts: { language?: string | null; prompt?: string }): Promise<TranscriptionResult>;
}
