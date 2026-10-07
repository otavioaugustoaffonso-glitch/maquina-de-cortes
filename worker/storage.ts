import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "./env";
import { db } from "./supabase";

/** Baixa um objeto do Storage para o disco via streaming (não carrega tudo em memória). */
export async function downloadToFile(bucket: string, objectPath: string, dest: string): Promise<void> {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
  if (error || !data) throw new Error(`Falha ao gerar URL de download (${bucket}/${objectPath}): ${error?.message}`);
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error(`Download falhou (${res.status}) para ${bucket}/${objectPath}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
}

/**
 * Envia um arquivo local ao Storage por streaming (endpoint REST padrão do Supabase Storage).
 * Evita bufferizar arquivos grandes (proxy de preview, zips) em memória.
 */
export async function uploadFile(bucket: string, objectPath: string, filePath: string, contentType: string): Promise<number> {
  const { size } = await fsp.stat(filePath);
  const url = `${env.supabaseUrl()}/storage/v1/object/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const body = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.serviceRoleKey()}`,
      apikey: env.serviceRoleKey(),
      "content-type": contentType,
      "content-length": String(size),
      "x-upsert": "true",
      "cache-control": "max-age=3600",
    },
    body,
    // necessário para enviar um stream no fetch do Node
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!res.ok) throw new Error(`Upload falhou (${res.status}) para ${bucket}/${objectPath}: ${await res.text()}`);
  return size;
}

export async function removeObjects(bucket: string, paths: string[]): Promise<void> {
  const valid = paths.filter(Boolean);
  if (!valid.length) return;
  const { error } = await db().storage.from(bucket).remove(valid);
  if (error) throw new Error(`Falha ao remover objetos de ${bucket}: ${error.message}`);
}
