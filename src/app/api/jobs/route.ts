import { z } from "zod";
import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { jobCounts, listJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

/** jobs.manage: recent jobs (payloads hold ids only) + counts per status. */
export const GET = handle(async (req: Request) => {
  await requireAdmin("jobs.manage");
  const status = z.enum(["pending", "running", "done", "failed", "dead"]).optional().parse(new URL(req.url).searchParams.get("status") ?? undefined);
  const [jobs, counts] = await Promise.all([listJobs({ status }), jobCounts()]);
  return json({ jobs, counts }, { headers: { "cache-control": "no-store" } });
});
