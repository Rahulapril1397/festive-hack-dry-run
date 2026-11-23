import "server-only";
import { rpc } from "@/lib/db/service";
import { registerJob } from "./runner";
import { taskEscalationScan, taskReminder } from "@/domain/tasks/jobs";

/** Every job the runner knows. Import this module (not runner.ts) where jobs are run. */
registerJob("task_reminder", taskReminder);
registerJob("task_escalation_scan", taskEscalationScan);
registerJob("expire_assignments", async () => {
  await rpc<number>("expire_assignments", {});
});
registerJob("jobs_cleanup", async () => {
  await rpc<number>("jobs_cleanup", {});
});

export { runDue, enqueue, registeredJobs } from "./runner";
