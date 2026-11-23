import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { AssignmentStatusInput } from "@/contracts/people";
import { setAssignmentStatus } from "@/domain/people/service";

export const dynamic = "force-dynamic";

/** users.manage: suspend / reactivate one assignment (the login keeps its other roles). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  const { status } = await parseBody(req, AssignmentStatusInput);
  return json(await setAssignmentStatus(s, (await params).id, status));
});
