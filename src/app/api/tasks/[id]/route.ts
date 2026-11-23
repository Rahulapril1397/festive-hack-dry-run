import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { TaskPatch } from "@/contracts/tasks";
import { getTask, updateTask } from "@/domain/tasks/service";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: P) => {
  const s = await requireSelected("tasks.read");
  return json(await getTask(s, (await params).id), { headers: { "cache-control": "no-store" } });
});

export const PATCH = handle(async (req: Request, { params }: P) => {
  const s = await requireSelected("tasks.manage");
  return json(await updateTask(s, (await params).id, await parseBody(req, TaskPatch)));
});
