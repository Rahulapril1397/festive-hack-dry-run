import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { VendorLoginInput } from "@/contracts/planning";
import { linkVendorLogin } from "@/domain/planning/service";

/** vendors.manage. PUT { vendorId, email | null } → the user who signs in as this vendor (sees only its own bookings). */
export const PUT = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "vendors.manage", s?.weddingId ?? "");
  const b = await parseBody(req, VendorLoginInput);
  await linkVendorLogin(ctx.weddingId, ctx.userId, b.vendorId, b.email);
  return json({ ok: true });
});
