import type { JobType } from "@/lib/types";
import { env } from "./env";
import { log } from "./log";
import { db, must } from "./supabase";

export type Job = {
  id: string;
  user_id: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

/** Erro que não deve ser re-tentado (ex.: arquivo inválido, sem créditos). */
export class PermanentError extends Error {
  readonly permanent = true;
}

export async function claimJob(types?: JobType[]): Promise<Job | null> {
  const rows = await must(db().rpc("claim_job", { p_worker: env.workerId, p_types: types ?? null }), "claim_job");
  const list = (rows ?? []) as Job[];
  return list[0] ?? null;
}

export async function heartbeat(jobId: string): Promise<void> {
  await db().from("jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", jobId);
}

export async function completeJob(jobId: string): Promise<void> {
  await must(
    db().from("jobs").update({ status: "completed", finished_at: new Date().toISOString(), locked_by: null }).eq("id", jobId),
    "completeJob",
  );
}

/** Falha com retry exponencial (30s, 2min, 8min...) até max_attempts. */
export async function failJob(job: Job, err: unknown): Promise<{ final: boolean }> {
  const message = err instanceof Error ? err.message : String(err);
  const permanent = err instanceof PermanentError;
  const final = permanent || job.attempts >= job.max_attempts;
  const delay = 30 * 4 ** (job.attempts - 1);
  await must(
    db()
      .from("jobs")
      .update({
        status: final ? "failed" : "queued",
        last_error: message.slice(0, 4000),
        locked_by: null,
        locked_at: null,
        run_at: final ? undefined : new Date(Date.now() + delay * 1000).toISOString(),
        finished_at: final ? new Date().toISOString() : null,
      })
      .eq("id", job.id),
    "failJob",
  );
  log.warn("job falhou", { jobId: job.id, type: job.type, attempt: job.attempts, final, error: message });
  return { final };
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { userId: string; priority?: number }) {
  return must(
    db().from("jobs").insert({ type, payload, user_id: opts.userId, priority: opts.priority ?? 100 }).select("id").single(),
    "enqueue",
  );
}

export async function requeueStale(timeoutSeconds = 600): Promise<number> {
  const n = await must(db().rpc("requeue_stale_jobs", { p_timeout_seconds: timeoutSeconds }), "requeue_stale_jobs");
  return Number(n ?? 0);
}
