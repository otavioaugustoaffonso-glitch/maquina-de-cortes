import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Gera URLs assinadas (temporárias) em lote. Arquivos são privados; RLS garante a posse. */
export async function signPaths(supabase: SupabaseClient, bucket: string, paths: (string | null | undefined)[], expiresIn = 3600) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
  for (const item of data ?? []) if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  return map;
}
