import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { PaymentInput } from "@/contracts/vendors";
import { addPayment } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("vendors.commercial.write");
  await addPayment(s, (await params).id, await parseBody(req, PaymentInput));
  return json({ ok: true }, 201);
});
