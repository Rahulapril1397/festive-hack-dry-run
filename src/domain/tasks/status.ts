/** Task status machine — must equal task_transition_ok() in supabase/migrations/0022_tasks.sql. */
export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["blocked", "done", "cancelled", "open"],
  blocked: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export const canTransition = (from: TaskStatus, to: TaskStatus) => TRANSITIONS[from].includes(to);
export const isTerminal = (s: TaskStatus) => s === "done" || s === "cancelled";

export const STATUS_LABEL: Record<TaskStatus, string> = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" };

export function isOverdue(t: { status: TaskStatus; due_at?: string | null; dueAt?: string | null }, now = Date.now()): boolean {
  const due = t.dueAt ?? t.due_at;
  return !!due && !isTerminal(t.status) && new Date(due).getTime() < now;
}

/** Plain text to paste into WhatsApp (no PII beyond the owner's name the host already sees). */
export function whatsappText(t: { title: string; description?: string | null; dueAt: string | null; ownerName: string | null; eventName?: string | null; status: TaskStatus }, link?: string): string {
  const due = t.dueAt ? new Date(t.dueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : null;
  return [
    `📋 *${t.title}*`,
    t.eventName ? `Function: ${t.eventName}` : null,
    t.ownerName ? `Owner: ${t.ownerName}` : null,
    due ? `Due: ${due}` : null,
    `Status: ${STATUS_LABEL[t.status]}`,
    t.description ? `\n${t.description}` : null,
    link ? `\n${link}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
}
