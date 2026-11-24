import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { AssignEventInput } from "@/contracts/vendors";
import { assignToEvent } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string; eventId: string }> };

/** vendors.manage: book a vendor for a function (scope, arrival time). */
export const PUT = handle(async (req: Request, { params }: P) => {
  const s = await requireSelected("vendors.manage");
  const { id, eventId } = await params;
  await assignToEvent(s, id, eventId, await parseBody(req, AssignEventInput));
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const s = await requireSelected("vendors.manage");
  const { id, eventId } = await params;
  await assignToEvent(s, id, eventId, null);
  return json({ ok: true });
});
