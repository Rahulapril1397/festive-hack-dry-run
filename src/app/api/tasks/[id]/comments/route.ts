import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { TaskCommentInput } from "@/contracts/tasks";
import { commentOnTask } from "@/domain/tasks/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected(["tasks.manage", "tasks.update_own"]);
  const { body } = await parseBody(req, TaskCommentInput);
  return json(await commentOnTask(s, (await params).id, body), 201);
});
