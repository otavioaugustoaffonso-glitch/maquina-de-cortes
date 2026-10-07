import { PermanentError } from "../queue";

/**
 * Trava de custo: provedores que COBRAM por uso (sem plano gratuito) só podem ser
 * usados com autorização explícita via ALLOW_PAID_PROVIDERS=true.
 * Provedores com plano gratuito (Groq, Gemini) e locais (faster-whisper, Ollama,
 * heurístico) não passam por esta trava.
 */
export function assertPaidAllowed(provider: string): void {
  if (process.env.ALLOW_PAID_PROVIDERS !== "true") {
    throw new PermanentError(
      `O provedor "${provider}" é pago e está bloqueado. Use um provedor gratuito ou defina ALLOW_PAID_PROVIDERS=true para autorizar cobranças.`,
    );
  }
}
