/** Pure scheduling helpers for the job runner (unit-tested; no I/O). */

/** Retry delays after attempt 1, 2, 3. The 4th failed attempt is final (dead). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** When to retry after `attempts` failed runs, or null = dead. */
export function retryAt(attempts: number, now: Date): Date | null {
  const d = RETRY_DELAYS_MS[attempts - 1];
  return d === undefined ? null : new Date(now.getTime() + d);
}

/** "task_escalation_scan:2026-12-13T10:15Z" — one key per `minutes` slot, so a recurring job is enqueued once per slot no matter how many ticks run. */
export function slotKey(name: string, now: Date, minutes: number): string {
  const ms = minutes * 60_000;
  const start = new Date(Math.floor(now.getTime() / ms) * ms);
  return `${name}:${start.toISOString().slice(0, 16)}Z`;
}

/** Calendar day in India (IST, UTC+5:30) — nightly jobs dedupe per Indian day. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Reminder offsets before a task's due time. */
export const REMINDERS = [
  { kind: "24h", beforeMs: 24 * 3600_000 },
  { kind: "1h", beforeMs: 3600_000 },
] as const;
export type ReminderKind = (typeof REMINDERS)[number]["kind"];

/** Reminders still in the future for a due time. */
export function reminderSchedule(dueAt: Date, now: Date): { kind: ReminderKind; runAt: Date }[] {
  return REMINDERS.map((r) => ({ kind: r.kind, runAt: new Date(dueAt.getTime() - r.beforeMs) })).filter((r) => r.runAt.getTime() > now.getTime());
}

/** Escalation level a task should be at, given how long it has been overdue. */
export function escalationLevel(dueAt: Date, now: Date, escalationHours: number): 0 | 1 | 2 {
  const overdueH = (now.getTime() - dueAt.getTime()) / 3600_000;
  if (overdueH >= escalationHours + 6) return 2;
  if (overdueH >= escalationHours) return 1;
  return 0;
}
