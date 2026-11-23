import { timingSafeEqual } from "node:crypto";
import { handle, json, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { runDue } from "@/lib/jobs/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every minute by the Helm CronJob (deploy/helm/pehle-aap/templates/jobs-cronjob.yaml).
 * Safe to call in parallel: jobs are claimed with SKIP LOCKED.
 */
export const POST = handle(async (req: Request) => {
  publicRoute("X-Jobs-Token shared secret (timing-safe compare); no user data in the response");
  const expected = process.env.JOBS_TOKEN ?? "";
  if (expected.length < 16) throw new AppError("FORBIDDEN", "Job runner is off (JOBS_TOKEN not set)");
  const got = Buffer.from(req.headers.get("x-jobs-token") ?? "");
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AppError("FORBIDDEN");
  const r = await runDue();
  return json({ claimed: r.claimed, done: r.done, failed: r.failed, dead: r.dead });
});
