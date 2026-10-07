import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente com SERVICE ROLE — ignora RLS. Uso EXCLUSIVO em rotas de API no servidor,
 * sempre após verificar o usuário e a posse do recurso. Nunca importar em client components.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
