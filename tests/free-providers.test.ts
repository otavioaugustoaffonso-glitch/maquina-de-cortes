import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClipAnalyzer } from "../worker/ai/analysis";
import { OpenAICompatibleAnalyzer, parseClips } from "../worker/ai/analysis/openai-compatible";
import { getTranscriptionProvider } from "../worker/ai/transcription";
import { env } from "../worker/env";

const clip = {
  start: 10, end: 40, title: "T", title_on_screen: "T", description: "d", hook: "h", reason: "r", category: "dica",
  keywords: ["a"], hashtags: ["#a"], social_caption: "c", scores: { hook: 8, clarity: 7, value: 8, emotion: 6, curiosity: 7, standalone: 8 },
};

describe("somente provedores gratuitos", () => {
  it.skipIf(Boolean(process.env.TRANSCRIPTION_PROVIDER || process.env.ANALYSIS_PROVIDER))("padrões são gratuitos", () => {
    expect(env.transcriptionProvider).toBe("local");
    expect(env.analysisProvider).toBe("heuristic");
    expect(getClipAnalyzer().name).toBe("heuristic");
    expect(getTranscriptionProvider().name).toBe("local");
  });

  it("provedores pagos não existem no projeto", () => {
    const prev = { a: env.analysisProvider, t: env.transcriptionProvider };
    try {
      (env as { analysisProvider: string }).analysisProvider = "anthropic";
      expect(() => getClipAnalyzer()).toThrow(/inválido/);
      (env as { transcriptionProvider: string }).transcriptionProvider = "openai";
      expect(() => getTranscriptionProvider()).toThrow(/inválido/);
    } finally {
      env.analysisProvider = prev.a;
      env.transcriptionProvider = prev.t;
    }
  });
});

describe("parser de JSON dos LLMs gratuitos", () => {
  it("aceita JSON com texto ao redor e descarta itens inválidos", () => {
    const out = parseClips(`Aqui está:\n{"clips":[${JSON.stringify(clip)},{"start":"x"}]}\nPronto`);
    expect(out).toHaveLength(1);
    expect(out![0].scores.hook).toBe(8);
  });
  it("preenche campos opcionais ausentes", () => {
    const out = parseClips(JSON.stringify({ clips: [{ start: 1, end: 20, title: "x", scores: clip.scores }] }));
    expect(out![0].category).toBe("outro");
  });
  it("retorna null para resposta sem JSON", () => {
    expect(parseClips("desculpe")).toBeNull();
  });
});

describe("analisador compatível com OpenAI (servidor local simulado)", () => {
  let server: http.Server;
  let calls = 0;
  let lastBody: { response_format?: unknown; messages?: { content: string }[] } = {};
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls++;
        lastBody = JSON.parse(body);
        if (calls === 1) {
          // simula limite do plano gratuito
          res.writeHead(429, { "retry-after": "0.05", "content-type": "application/json" });
          return res.end('{"error":"rate limit"}');
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ clips: [clip] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    delete process.env.LLM_BASE_URL;
  });

  it("espera no 429 e depois retorna os cortes", async () => {
    const analyzer = new OpenAICompatibleAnalyzer("ollama");
    const r = await analyzer.analyze({ transcript: "[0.0-5.0] Olá", durationSeconds: 60, language: "pt", clipCount: { min: 1, max: 3 } });
    expect(calls).toBe(2);
    expect(r.clips).toHaveLength(1);
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(lastBody.response_format).toEqual({ type: "json_object" });
    expect(lastBody.messages![0].content).toContain('"clips"');
    expect(analyzer.maxTranscriptChars).toBe(24_000);
  });

  it("exige chave para provedores com plano gratuito na nuvem", () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.LLM_API_KEY;
    expect(() => new OpenAICompatibleAnalyzer("groq")).toThrow(/GROQ_API_KEY/);
  });
});
