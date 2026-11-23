import "server-only";
import { db, rpc } from "@/lib/db/service";
import { notify, usersWithRoles, type JobContext } from "@/lib/jobs/runner";
import { escalationLevel } from "@/lib/jobs/schedule";
import type { TaskStatus } from "./status";

/**
 * Job handlers for tasks (Stage 3 E1 T5).
 *  task_reminder        {taskId, dueAt, kind}: notify the owner; skipped when the task is finished
 *                       or its due time changed since the reminder was scheduled.
 *  task_escalation_scan every 15 min: overdue ≥ escalation hours → level 1 (coordinators, else
 *                       hosts); ≥ +6 h → level 2 (hosts). Each level fires once per due time.
 */
export async function taskReminder(payload: Record<string, unknown>): Promise<void> {
  const taskId = String(payload.taskId ?? "");
  const { data: t, error } = await db()
    .from("task")
    .select("id, wedding_id, title, status, due_at, owner:owner_participant_id(user_id, display_name)")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!t) return; // task deleted
  const status = t.status as TaskStatus;
  const sameDue = !!t.due_at && new Date(t.due_at).getTime() === new Date(String(payload.dueAt)).getTime();
  if (status === "done" || status === "cancelled" || !sameDue) return; // stale: skip quietly
  const owner = t.owner as unknown as { user_id: string | null } | null;
  const kind = payload.kind === "1h" ? "1 hour" : "24 hours";
  const sent = owner?.user_id
    ? await notify({ weddingId: t.wedding_id, userIds: [owner.user_id], title: `Due in ${kind}: ${t.title}`, link: `/tasks?task=${t.id}`, kind: "task_reminder" })
    : 0;
  await rpc("task_log_event", { p_task: t.id, p_type: "reminder_sent", p_data: { kind: payload.kind, delivered: sent > 0 } });
}

export async function taskEscalationScan(_payload: Record<string, unknown>, ctx: JobContext): Promise<void> {
  const { data, error } = await db()
    .from("task")
    .select("id, wedding_id, title, due_at, escalation_level, owner:owner_participant_id(display_name), wedding:wedding_id(task_escalation_hours)")
    .in("status", ["open", "in_progress", "blocked"])
    .lt("due_at", ctx.now.toISOString())
    .lt("escalation_level", 2)
    .limit(1000);
  if (error) throw new Error(error.message);
  for (const t of data ?? []) {
    const hours = Number((t.wedding as unknown as { task_escalation_hours: number } | null)?.task_escalation_hours ?? 2);
    const level = escalationLevel(new Date(t.due_at as string), ctx.now, hours);
    if (level <= t.escalation_level) continue;
    let roles = level === 1 ? ["coordinator"] : ["host"];
    let recipients = await usersWithRoles(t.wedding_id, roles);
    if (!recipients.length && level === 1) recipients = await usersWithRoles(t.wedding_id, (roles = ["host"]));
    const raised = await rpc<boolean>("task_escalate", { p_task: t.id, p_level: level, p_data: { notified: recipients.length, roles } });
    if (!raised) continue; // another tick got there first
    const owner = (t.owner as unknown as { display_name: string } | null)?.display_name;
    await notify({
      weddingId: t.wedding_id,
      userIds: recipients.map((r) => r.user_id),
      title: `${level === 2 ? "Still overdue" : "Overdue"}: ${t.title}`,
      body: owner ? `Owner: ${owner}` : "No owner assigned",
      link: `/tasks?task=${t.id}`,
      kind: `task_escalation_${level}`,
    });
  }
}
