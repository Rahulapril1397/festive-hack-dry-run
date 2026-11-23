import "server-only";
import type { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { hasPermission, type Session } from "@/lib/authz";
import { enqueue } from "@/lib/jobs/runner";
import { reminderSchedule } from "@/lib/jobs/schedule";
import { participantFor } from "@/domain/people/service";
import type { Task, TaskDetail, TaskInput, TaskPatch, TaskQuery } from "@/contracts/tasks";
import { isOverdue, type TaskStatus } from "./status";

type Row = {
  id: string;
  wedding_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Task["priority"];
  due_at: string | null;
  escalation_level: number;
  owner_participant_id: string | null;
  vendor_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  owner: { id: string; display_name: string; user_id: string | null } | null;
  event: { id: string; name: string } | null;
};
const SELECT = "id, wedding_id, title, description, status, priority, due_at, escalation_level, owner_participant_id, vendor_id, created_at, updated_at, completed_at, owner:owner_participant_id(id, display_name, user_id), event:event_id(id, name)";

async function vendorNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await db().from("vendor").select("id, name").in("id", ids);
  if (error) return new Map(); // vendors module (0210) not installed yet
  return new Map((data ?? []).map((v) => [v.id as string, v.name as string]));
}

function toTask(r: Row, vendors: Map<string, string>, now = Date.now()): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    dueAt: r.due_at,
    overdue: isOverdue(r, now),
    escalationLevel: r.escalation_level,
    owner: r.owner ? { id: r.owner.id, name: r.owner.display_name, userId: r.owner.user_id } : null,
    event: r.event,
    vendor: r.vendor_id ? { id: r.vendor_id, name: vendors.get(r.vendor_id) ?? "Vendor" } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

export async function listTasks(s: Session, q: z.infer<typeof TaskQuery>): Promise<Task[]> {
  let query = db().from("task").select(SELECT).eq("wedding_id", s.weddingId).limit(500);
  if (q.status) query = query.eq("status", q.status);
  if (q.eventId) query = query.eq("event_id", q.eventId);
  if (q.vendorId) query = query.eq("vendor_id", q.vendorId);
  if (q.owner) query = query.eq("owner_participant_id", q.owner);
  if (q.mine) {
    const me = await participantFor(s.weddingId, s.userId);
    if (!me) return [];
    query = query.eq("owner_participant_id", me);
  }
  if (q.overdue) query = query.in("status", ["open", "in_progress", "blocked"]).lt("due_at", new Date().toISOString());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const vendors = await vendorNames([...new Set(rows.map((r) => r.vendor_id).filter(Boolean))] as string[]);
  const now = Date.now();
  return rows
    .map((r) => toTask(r, vendors, now))
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        Number(a.status === "done" || a.status === "cancelled") - Number(b.status === "done" || b.status === "cancelled") ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    );
}

async function getRow(weddingId: string, id: string): Promise<Row> {
  const { data, error } = await db().from("task").select(SELECT).eq("wedding_id", weddingId).eq("id", id).maybeSingle();
  if (error?.code === "22P02" || (!error && !data)) throw new AppError("NOT_FOUND");
  if (error) throw new Error(error.message);
  return data as unknown as Row;
}

/** tasks.manage, or tasks.update_own when the caller's participant owns the task. */
async function canUpdate(s: Session, row: Row): Promise<boolean> {
  if (await hasPermission(s, "tasks.manage", s.weddingId)) return true;
  return !!row.owner?.user_id && row.owner.user_id === s.userId && (await hasPermission(s, "tasks.update_own", s.weddingId));
}
export async function assertCanUpdate(s: Session, id: string) {
  if (!(await canUpdate(s, await getRow(s.weddingId, id)))) throw new AppError("FORBIDDEN", "Only the owner or a task manager can change this task");
}

export async function getTask(s: Session, id: string): Promise<TaskDetail> {
  const row = await getRow(s.weddingId, id);
  const { data: ev, error } = await db().from("task_event").select("id, type, actor, data, created_at").eq("task_id", id).order("id", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  const actors = [...new Set((ev ?? []).map((e) => e.actor).filter(Boolean))] as string[];
  const { data: users } = actors.length ? await db().from("app_user").select("id, email, display_name").in("id", actors) : { data: [] };
  const who = new Map((users ?? []).map((u) => [u.id as string, (u.display_name as string | null) ?? (u.email as string)]));
  const vendors = await vendorNames(row.vendor_id ? [row.vendor_id] : []);
  return {
    ...toTask(row, vendors),
    canUpdate: await canUpdate(s, row),
    events: (ev ?? []).map((e) => ({ id: e.id, type: e.type, actorEmail: e.actor ? (who.get(e.actor) ?? null) : null, data: e.data ?? {}, createdAt: e.created_at })),
  };
}

/** Enqueue the 24 h / 1 h reminders for the current due time (deduped per task + due time). */
export async function scheduleReminders(task: { id: string; due_at: string | null; status: TaskStatus; owner_participant_id: string | null }, now = new Date()) {
  if (!task.due_at || !task.owner_participant_id || task.status === "done" || task.status === "cancelled") return;
  const due = new Date(task.due_at);
  await Promise.all(
    reminderSchedule(due, now).map((r) =>
      enqueue("task_reminder", { taskId: task.id, dueAt: due.toISOString(), kind: r.kind }, { runAt: r.runAt, dedupeKey: `task_reminder:${task.id}:${due.toISOString()}:${r.kind}` }),
    ),
  );
}

export async function createTask(s: Session, input: z.infer<typeof TaskInput>): Promise<Task> {
  if (input.vendorId) await assertVendor(s.weddingId, input.vendorId);
  const row = await rpc<Row>("task_create", { p_actor: s.userId, p_wedding: s.weddingId, p: input });
  await scheduleReminders(row);
  return toTask(await getRow(s.weddingId, row.id), await vendorNames(row.vendor_id ? [row.vendor_id] : []));
}

export async function updateTask(s: Session, id: string, patch: z.infer<typeof TaskPatch>): Promise<Task> {
  if (patch.vendorId) await assertVendor(s.weddingId, patch.vendorId);
  const row = await rpc<Row>("task_update", { p_actor: s.userId, p_wedding: s.weddingId, p_task: id, p: patch });
  if ("dueAt" in patch || "ownerParticipantId" in patch) await scheduleReminders(row);
  return toTask(await getRow(s.weddingId, id), await vendorNames(row.vendor_id ? [row.vendor_id] : []));
}

export async function setTaskStatus(s: Session, id: string, status: TaskStatus, note?: string): Promise<Task> {
  await assertCanUpdate(s, id);
  const row = await rpc<Row>("task_set_status", { p_actor: s.userId, p_wedding: s.weddingId, p_task: id, p_status: status, p_note: note ?? null });
  return toTask(await getRow(s.weddingId, row.id), await vendorNames(row.vendor_id ? [row.vendor_id] : []));
}

export async function commentOnTask(s: Session, id: string, body: string): Promise<TaskDetail> {
  await assertCanUpdate(s, id);
  await rpc("task_comment", { p_actor: s.userId, p_wedding: s.weddingId, p_task: id, p_body: body });
  return getTask(s, id);
}

async function assertVendor(weddingId: string, vendorId: string) {
  const { data, error } = await db().from("vendor").select("id").eq("id", vendorId).eq("wedding_id", weddingId).maybeSingle();
  if (error || !data) throw new AppError("NOT_FOUND", "Vendor not found");
}

/** Owners to pick from (active participants of the wedding). */
export async function taskOwners(weddingId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await db().from("participant").select("id, display_name").eq("wedding_id", weddingId).eq("status", "active").order("display_name");
  return (data ?? []).map((p) => ({ id: p.id as string, name: p.display_name as string }));
}

/** Counts for the Host overview card and PinkyBua. */
export async function taskSummary(weddingId: string): Promise<{ open: number; overdue: number; dueToday: number; blocked: number }> {
  const { data } = await db().from("task").select("status, due_at").eq("wedding_id", weddingId).in("status", ["open", "in_progress", "blocked"]);
  const now = Date.now();
  const endOfDay = new Date(new Date(now + 330 * 60_000).toISOString().slice(0, 10) + "T23:59:59+05:30").getTime();
  const rows = (data ?? []) as { status: TaskStatus; due_at: string | null }[];
  return {
    open: rows.length,
    overdue: rows.filter((r) => r.due_at && new Date(r.due_at).getTime() < now).length,
    dueToday: rows.filter((r) => r.due_at && new Date(r.due_at).getTime() >= now && new Date(r.due_at).getTime() <= endOfDay).length,
    blocked: rows.filter((r) => r.status === "blocked").length,
  };
}
