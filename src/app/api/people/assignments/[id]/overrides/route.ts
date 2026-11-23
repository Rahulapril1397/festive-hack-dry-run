import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { OverrideInput } from "@/contracts/people";
import { setOverride } from "@/domain/people/service";

export const dynamic = "force-dynamic";

/** users.manage: deny one permission for one assignment (deny beats allow, including Flagsmith). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  const { permissionKey, deny } = await parseBody(req, OverrideInput);
  return json(await setOverride(s, (await params).id, permissionKey, deny));
});
