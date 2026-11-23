import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { AssignInput } from "@/contracts/people";
import { assignPerson } from "@/domain/people/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  return json(await assignPerson(s, (await params).id, await parseBody(req, AssignInput)), 201);
});
