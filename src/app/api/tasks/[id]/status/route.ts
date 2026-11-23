import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { TaskStatusInput } from "@/contracts/tasks";
import { setTaskStatus } from "@/domain/tasks/service";

export const dynamic = "force-dynamic";

/** tasks.manage, or tasks.update_own for the owner (ownership checked in the service). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected(["tasks.manage", "tasks.update_own"]);
  const { status, note } = await parseBody(req, TaskStatusInput);
  return json(await setTaskStatus(s, (await params).id, status, note));
});
