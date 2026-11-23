import { handle, json, parseBody } from "@/lib/http";
import { CreateRoleInput } from "@/contracts/admin";
import { PERMISSIONS } from "@/lib/authz/catalogue";
import { requireAdmin } from "@/domain/admin/guard";
import { createRole, listRoles } from "@/domain/admin/service";

export const dynamic = "force-dynamic";

/** users.manage: roles + the permission catalogue. */
export const GET = handle(async () => {
  await requireAdmin("users.manage");
  return json({ roles: await listRoles(), permissions: [...PERMISSIONS] });
});

/** roles.manage (super admin): roles apply to every wedding. */
export const POST = handle(async (req: Request) => {
  const s = await requireAdmin("roles.manage");
  return json(await createRole(s, await parseBody(req, CreateRoleInput)), 201);
});
