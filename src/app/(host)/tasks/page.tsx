import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { listEvents } from "@/lib/db/service";
import { listTasks, taskOwners } from "@/domain/tasks/service";
import { participantFor } from "@/domain/people/service";
import { TasksBoard } from "./TasksBoard";

export const dynamic = "force-dynamic";

/** Tasks (Stage 3 E1 T4): everyone with tasks.read; managers create and assign. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const s = await requirePage("tasks.read", "/tasks");
  const [tasks, owners, events, canManage, canUpdateOwn, me, sp] = await Promise.all([
    listTasks(s, {}),
    taskOwners(s.weddingId),
    listEvents(s.weddingId),
    hasPermission(s, "tasks.manage"),
    hasPermission(s, "tasks.update_own"),
    participantFor(s.weddingId, s.userId),
    searchParams,
  ]);
  return (
    <TasksBoard
      initialTasks={tasks}
      owners={owners}
      events={events.map((e) => ({ id: e.id, name: e.name }))}
      me={me}
      can={{ manage: canManage, updateOwn: canUpdateOwn }}
      openTaskId={sp.task ?? null}
    />
  );
}
