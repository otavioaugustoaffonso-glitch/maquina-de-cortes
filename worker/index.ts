/**
 * Worker de processamento em background.
 * Consome a fila `public.jobs` (Postgres/Supabase) usando `claim_job`
 * (FOR UPDATE SKIP LOCKED): pode rodar em várias máquinas em paralelo.
 *
 *   npm run worker
 */
import fs from "node:fs/promises";
import { env } from "./env";
import { log } from "./log";
import { claimJob, completeJob, failJob, heartbeat, requeueStale, type Job } from "./queue";
import { cleanupCache, setVideoStatus } from "./jobs/common";
import { cleanupExpiredExports, exportZipJob } from "./jobs/export-zip";
import { processVideo } from "./jobs/process-video";
import { maybeFinishVideo, renderClipJob } from "./jobs/render-clip";

let stopping = false;
const running = new Set<Promise<void>>();

async function handle(job: Job): Promise<void> {
  const started = Date.now();
  log.info("job iniciado", { jobId: job.id, type: job.type, attempt: job.attempts });
  const beat = () => heartbeat(job.id).catch(() => {});
  const interval = setInterval(beat, 30_000);
  try {
    switch (job.type) {
      case "process_video":
        await processVideo(job, beat);
        break;
      case "render_clip":
        await renderClipJob(job, beat);
        break;
      case "export_zip":
        await exportZipJob(job, beat);
        break;
      default:
        throw new Error(`Tipo de job desconhecido: ${job.type}`);
    }
    await completeJob(job.id);
    log.info("job concluído", { jobId: job.id, type: job.type, ms: Date.now() - started });
  } catch (err) {
    const { final } = await failJob(job, err);
    if (final && job.type === "process_video") {
      const message = err instanceof Error ? err.message : String(err);
      await setVideoStatus(String(job.payload.videoId), "failed", 100, { error: message.slice(0, 1000) }).catch(() => {});
    }
    if (final && job.type === "render_clip") await maybeFinishVideo(String(job.payload.videoId)).catch(() => {});
  } finally {
    clearInterval(interval);
  }
}

async function loop() {
  await fs.mkdir(env.tmpDir, { recursive: true });
  log.info("worker iniciado", { workerId: env.workerId, concurrency: env.concurrency, tmpDir: env.tmpDir });
  let lastMaintenance = 0;
  while (!stopping) {
    if (Date.now() - lastMaintenance > 5 * 60_000) {
      lastMaintenance = Date.now();
      await requeueStale().then((n) => n && log.warn("jobs órfãos recolocados na fila", { n })).catch((e) => log.error("requeue", { e: String(e) }));
      await cleanupCache().catch(() => {});
      await cleanupExpiredExports().catch(() => {});
    }
    if (running.size >= env.concurrency) {
      await Promise.race(running);
      continue;
    }
    let job: Job | null = null;
    try {
      job = await claimJob();
    } catch (e) {
      log.error("falha ao buscar job", { error: String(e) });
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, env.pollIntervalMs));
      continue;
    }
    const p = handle(job).finally(() => running.delete(p));
    running.add(p);
  }
  await Promise.all(running);
  log.info("worker finalizado");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info("encerrando após concluir jobs em andamento...", { signal: sig });
  });
}

loop().catch((e) => {
  log.error("erro fatal no worker", { error: String(e) });
  process.exit(1);
});
