import { handle, json, parseBody } from "@/lib/http";
import { CreateAssignmentInput } from "@/contracts/admin";
import { requireAdmin } from "@/domain/admin/guard";
import { assign } from "@/domain/admin/service";

/** users.manage in the target wedding (super admin for wedding-less super_admin grants). */
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, CreateAssignmentInput);
  const s = await requireAdmin("users.manage", input.weddingId ?? undefined);
  return json(await assign(s, input), 201);
});
