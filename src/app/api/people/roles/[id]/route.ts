import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { EditRoleInput } from "@/contracts/people";
import { editWeddingRole } from "@/domain/people/service";

export const dynamic = "force-dynamic";

/** users.manage: edit a custom role of this wedding (system templates are changed in /admin, roles.manage). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  return json(await editWeddingRole(s, (await params).id, await parseBody(req, EditRoleInput)));
});
