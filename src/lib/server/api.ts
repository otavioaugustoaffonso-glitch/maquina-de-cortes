import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { createClient } from "../supabase/server";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * Proteções comuns das rotas de API:
 * - exige usuário autenticado (sessão validada no Supabase Auth);
 * - em mutações, exige mesma origem (mitiga CSRF) e JSON.
 */
export async function requireUser(req: NextRequest): Promise<{ user: User; supabase: SupabaseClient }> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) throw new ApiError(403, "Origem não permitida");
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError(401, "Não autenticado");
  return { user: data.user, supabase };
}

export async function parseBody<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "JSON inválido");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/** Envolve um handler tratando ApiError e erros inesperados (sem vazar detalhes internos). */
export function handler<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return jsonError(e.status, e.message);
      console.error("[api]", e);
      return jsonError(500, "Erro interno. Tente novamente.");
    }
  };
}

export const serverLimits = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024,
  maxConcurrentVideos: Number(process.env.MAX_CONCURRENT_VIDEOS) || 3,
};
