import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { requireAdmin, requireSuperAdmin } from "@/domain/admin/guard";
import { requireSelected } from "@/lib/authz";
import { assignmentWedding, unassign } from "@/domain/admin/service";

type Ctx = { params: Promise<{ id: string }> };

/** users.manage in the assignment's wedding. Removing the last super admin → 409 LAST_SUPER_ADMIN. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await requireSelected("users.manage"); // before any lookup, so assignment ids cannot be probed
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const a = await assignmentWedding(id);
  const s = await requireAdmin("users.manage", a.weddingId ?? undefined);
  if (a.weddingId === null || a.roleKey === "super_admin") requireSuperAdmin(s);
  await unassign(s, id);
  return json({ ok: true });
});
