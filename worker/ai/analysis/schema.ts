import { z } from "zod";

/** Esquema da resposta estruturada do LLM (validado no recebimento). */
export const ClipSchema = z.object({
  start: z.number(),
  end: z.number(),
  title: z.string(),
  title_on_screen: z.string(),
  description: z.string(),
  hook: z.string(),
  reason: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
  hashtags: z.array(z.string()),
  social_caption: z.string(),
  scores: z.object({
    hook: z.number(),
    clarity: z.number(),
    value: z.number(),
    emotion: z.number(),
    curiosity: z.number(),
    standalone: z.number(),
  }),
});

export const AnalysisSchema = z.object({ clips: z.array(ClipSchema) });
