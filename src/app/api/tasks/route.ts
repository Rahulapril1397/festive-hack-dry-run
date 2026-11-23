import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { TaskInput, TaskQuery } from "@/contracts/tasks";
import { createTask, listTasks } from "@/domain/tasks/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const s = await requireSelected("tasks.read");
  const q = TaskQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json({ tasks: await listTasks(s, q) }, { headers: { "cache-control": "no-store" } });
});

export const POST = handle(async (req: Request) => {
  const s = await requireSelected("tasks.manage");
  return json(await createTask(s, await parseBody(req, TaskInput)), 201);
});
