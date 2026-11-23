import "server-only";
import { rpc, db } from "@/lib/db/service";
import { log } from "@/lib/log";
import { MAX_ATTEMPTS, istDay, retryAt, slotKey } from "./schedule";

export type JobRow = {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  run_at: string;
  status: "pending" | "running" | "done" | "failed" | "dead";
  attempts: number;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};
export type JobContext = { now: Date; jobId: string; attempt: number };
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const HANDLER_TIMEOUT_MS = 25_000;

export function registerJob(name: string, fn: JobHandler) {
  handlers.set(name, fn);
}
export const registeredJobs = () => [...handlers.keys()].sort();

/** Enqueue a job. With a dedupe key a repeat enqueue is a no-op (returns null). */
export async function enqueue(name: string, payload: Record<string, unknown> = {}, opts: { runAt?: Date; dedupeKey?: string } = {}): Promise<string | null> {
  return rpc<string | null>("jobs_enqueue", {
    p_name: name,
    p_payload: payload,
    p_run_at: (opts.runAt ?? new Date()).toISOString(),
    p_dedupe: opts.dedupeKey ?? null,
  });
}

/**
 * "Now" for the runner. JOBS_NOW (ISO time) lets staging/local simulate a future tick, e.g. to
 * see a reminder fire; it is ignored in production.
 */
export function jobsNow(): Date {
  const fake = process.env.JOBS_NOW;
  if (fake && process.env.APP_ENV !== "production") {
    const d = new Date(fake);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Recurring jobs: one enqueue per slot (dedupe key), however often /api/jobs/tick is called. */
export async function scheduleRecurring(now: Date) {
  await Promise.all([
    enqueue("task_escalation_scan", {}, { runAt: now, dedupeKey: slotKey("task_escalation_scan", now, 15) }),
    enqueue("expire_assignments", {}, { runAt: now, dedupeKey: `expire_assignments:${istDay(now)}` }),
    enqueue("jobs_cleanup", {}, { runAt: now, dedupeKey: `jobs_cleanup:${istDay(now)}` }),
  ]);
}

export type TickResult = { claimed: number; done: number; failed: number; dead: number; jobs: { id: string; name: string; status: string }[] };

/** Claim due jobs (SKIP LOCKED: parallel ticks never share a job), run them, record the outcome. */
export async function runDue(opts: { now?: Date; limit?: number; recurring?: boolean } = {}): Promise<TickResult> {
  const now = opts.now ?? jobsNow();
  if (opts.recurring !== false) await scheduleRecurring(now);
  const claimed = await rpc<JobRow[]>("jobs_claim", { p_now: now.toISOString(), p_limit: opts.limit ?? 20 });
  const out: TickResult = { claimed: claimed.length, done: 0, failed: 0, dead: 0, jobs: [] };
  for (const job of claimed) {
    const started = performance.now();
    let error: string | null = null;
    try {
      const fn = handlers.get(job.name);
      if (!fn) throw new Error(`no handler registered for "${job.name}"`);
      await withTimeout(fn(job.payload ?? {}, { now, jobId: job.id, attempt: job.attempts }), HANDLER_TIMEOUT_MS);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const retry = error ? (job.attempts >= MAX_ATTEMPTS ? null : retryAt(job.attempts, now)) : null;
    const fin = await rpc<JobRow | null>("jobs_finish", { p_id: job.id, p_ok: !error, p_error: error, p_retry_at: retry?.toISOString() ?? null });
    const status = fin?.status ?? (error ? (retry ? "failed" : "dead") : "done");
    if (status === "done") out.done++;
    else if (status === "dead") out.dead++;
    else out.failed++;
    out.jobs.push({ id: job.id, name: job.name, status });
    log(error ? "WARNING" : "INFO", "job", { job: job.name, jobId: job.id, attempt: job.attempts, status, latencyMs: Math.round(performance.now() - started), error: error ? "handler_error" : undefined });
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
}

export type NotifyInput = { weddingId: string; userIds?: string[]; familyId?: string; title: string; body?: string; link?: string; kind?: string };

/** In-app notifications (the 🔔 in the staff shell; family ones show on the pass). */
export async function notify(n: NotifyInput): Promise<number> {
  const rows = [
    ...[...new Set(n.userIds ?? [])].map((u) => ({ wedding_id: n.weddingId, user_id: u, title: n.title, body: n.body ?? "", link: n.link ?? null, kind: n.kind ?? null })),
    ...(n.familyId ? [{ wedding_id: n.weddingId, family_id: n.familyId, title: n.title, body: n.body ?? "", link: n.link ?? null, kind: n.kind ?? null }] : []),
  ];
  if (!rows.length) return 0;
  const { error } = await db().from("notification").insert(rows);
  if (error) throw new Error(`notify failed: ${error.code}`);
  return rows.length;
}

/** Logins holding one of `roles` in the wedding right now (active user + active assignment). */
export async function usersWithRoles(weddingId: string, roles: string[]): Promise<{ user_id: string; role_key: string }[]> {
  return rpc("wedding_role_users", { p_wedding: weddingId, p_roles: roles });
}

/** /admin/jobs list. */
export async function listJobs(opts: { status?: string; limit?: number } = {}): Promise<JobRow[]> {
  let q = db().from("job").select("id, name, payload, run_at, status, attempts, last_error, dedupe_key, created_at, updated_at, finished_at").order("updated_at", { ascending: false }).limit(Math.min(opts.limit ?? 100, 500));
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as JobRow[];
}

export async function jobCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    (["pending", "running", "failed", "dead", "done"] as const).map(async (s) => {
      const { count } = await db().from("job").select("id", { count: "exact", head: true }).eq("status", s);
      out[s] = count ?? 0;
    }),
  );
  return out;
}
