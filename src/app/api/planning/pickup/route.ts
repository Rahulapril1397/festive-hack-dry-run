import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { PickupInput } from "@/contracts/planning";
import { savePickup } from "@/domain/planning/service";

/** planning.write. PUT { familyId, driver: { name, phone, vehicle?, vendorId? } | null } → the driver the family sees on its pass. */
export const PUT = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  const b = await parseBody(req, PickupInput);
  await savePickup(ctx.weddingId, ctx.userId, b);
  return json({ ok: true });
});
