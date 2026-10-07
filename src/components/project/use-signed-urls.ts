"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Gera URLs assinadas no navegador (RLS garante que só os próprios arquivos são acessíveis).
 * Os caminhos são versionados a cada renderização, então o cache por caminho é seguro.
 */
export function useSignedUrls(bucket: string, paths: (string | null | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef<Record<string, string>>({});
  const key = useMemo(() => [...new Set(paths.filter(Boolean) as string[])].sort().join("|"), [paths]);

  useEffect(() => {
    const missing = key.split("|").filter((p) => p && !cache.current[p]);
    if (!missing.length) return;
    let alive = true;
    createClient()
      .storage.from(bucket)
      .createSignedUrls(missing, 6 * 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        for (const d of data) if (d.path && d.signedUrl) cache.current[d.path] = d.signedUrl;
        setUrls({ ...cache.current });
      });
    return () => {
      alive = false;
    };
  }, [bucket, key]);

  return urls;
}
