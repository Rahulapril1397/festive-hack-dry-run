import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { SetRolePermissionsInput } from "@/contracts/admin";
import { requireAdmin } from "@/domain/admin/guard";
import { setRolePermissions } from "@/domain/admin/service";

type Ctx = { params: Promise<{ id: string }> };

/** roles.manage. The super_admin role cannot be edited (409 SYSTEM_ROLE). */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await requireAdmin("roles.manage");
  const { permissionKeys } = await parseBody(req, SetRolePermissionsInput);
  return json(await setRolePermissions(s, id, permissionKeys));
});
