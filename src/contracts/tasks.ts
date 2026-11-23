import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/domain/tasks/status";

/**
 * Stage 3 Tasks API (E1 T4).
 * GET   /api/tasks?status&owner&mine=1&eventId&overdue=1   tasks.read → { tasks: Task[] }
 * POST  /api/tasks                       TaskInput → Task                       tasks.manage
 * GET   /api/tasks/:id                   → TaskDetail                            tasks.read
 * PATCH /api/tasks/:id                   TaskPatch → Task                        tasks.manage
 * POST  /api/tasks/:id/status            { status, note? } → Task                tasks.manage, or tasks.update_own as owner
 * POST  /api/tasks/:id/comments          { body } → TaskDetail                   tasks.manage, or tasks.update_own as owner
 */
const iso = z.string().datetime({ offset: true });
const uuidOrEmpty = z.union([z.literal(""), z.string().uuid()]);

export const TaskInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  ownerParticipantId: uuidOrEmpty.optional(),
  eventId: uuidOrEmpty.optional(),
  vendorId: uuidOrEmpty.optional(),
  dueAt: z.union([z.literal(""), iso]).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
});
export const TaskPatch = TaskInput.partial();
export const TaskStatusInput = z.object({ status: z.enum(TASK_STATUSES), note: z.string().trim().max(500).optional() });
export const TaskCommentInput = z.object({ body: z.string().trim().min(1).max(2000) });
export const TaskQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  owner: z.string().uuid().optional(),
  mine: z.literal("1").optional(),
  eventId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  overdue: z.literal("1").optional(),
});

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  overdue: boolean;
  escalationLevel: number;
  owner: { id: string; name: string; userId: string | null } | null;
  event: { id: string; name: string } | null;
  vendor: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type TaskEvent = { id: number; type: string; actorEmail: string | null; data: Record<string, unknown>; createdAt: string };
export type TaskDetail = Task & { events: TaskEvent[]; canUpdate: boolean };
