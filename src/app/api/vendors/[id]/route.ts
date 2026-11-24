import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { VendorPatch } from "@/contracts/vendors";
import { getVendor, updateVendor } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** Sections (contacts, commercial, documents, restricted notes) are included per permission. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const s = await requireSelected(["vendors.contacts.read", "vendors.manage", "vendors.commercial.read"]);
  return json(await getVendor(s, (await params).id), { headers: { "cache-control": "no-store" } });
});

export const PATCH = handle(async (req: Request, { params }: P) => {
  const s = await requireSelected("vendors.manage");
  return json(await updateVendor(s, (await params).id, await parseBody(req, VendorPatch)));
});
