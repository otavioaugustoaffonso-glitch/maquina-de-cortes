"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Cliente do navegador — usa apenas a chave pública (anon), protegido por RLS. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
