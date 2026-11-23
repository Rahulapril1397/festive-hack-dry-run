import { requirePage } from "@/components/shell/guard";
import { jobCounts, listJobs } from "@/lib/jobs/runner";
import { JobsTable } from "./JobsTable";

export const dynamic = "force-dynamic";

/** Background jobs (Stage 3 E1 T1): what ran, what failed, Retry. */
export default async function JobsPage() {
  await requirePage("jobs.manage", "/admin/jobs");
  const [jobs, counts] = await Promise.all([listJobs({ limit: 200 }), jobCounts()]);
  return <JobsTable initialJobs={jobs} initialCounts={counts} tokenConfigured={(process.env.JOBS_TOKEN ?? "").length >= 16} />;
}
