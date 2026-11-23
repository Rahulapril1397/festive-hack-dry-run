import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { CloneRoleInput } from "@/contracts/people";
import { cloneRole, listWeddingRoles } from "@/domain/people/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = await requireAdmin("users.manage");
  return json({ roles: await listWeddingRoles(s.weddingId) }, { headers: { "cache-control": "no-store" } });
});

/** users.manage: clone a template into a role that exists only in this wedding. */
export const POST = handle(async (req: Request) => {
  const s = await requireAdmin("users.manage");
  const { sourceRoleId, name } = await parseBody(req, CloneRoleInput);
  return json(await cloneRole(s, sourceRoleId, name), 201);
});
