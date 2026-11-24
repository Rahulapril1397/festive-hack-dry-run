import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { VendorInput, VendorQuery } from "@/contracts/vendors";
import { createVendor, listVendors } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

/** Any vendor permission; contact details only with vendors.contacts.read (domain decides). */
export const GET = handle(async (req: Request) => {
  const s = await requireSelected(["vendors.contacts.read", "vendors.manage", "vendors.commercial.read"]);
  const q = VendorQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json({ vendors: await listVendors(s, q) }, { headers: { "cache-control": "no-store" } });
});

export const POST = handle(async (req: Request) => {
  const s = await requireSelected("vendors.manage");
  return json(await createVendor(s, await parseBody(req, VendorInput)), 201);
});
