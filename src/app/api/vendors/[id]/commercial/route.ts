import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { CommercialInput } from "@/contracts/vendors";
import { setCommercial } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

/** vendors.commercial.write: quote, contract amount, terms, status (audited as a diff, no amounts in the log). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("vendors.commercial.write");
  await setCommercial(s, (await params).id, await parseBody(req, CommercialInput));
  return json({ ok: true });
});
