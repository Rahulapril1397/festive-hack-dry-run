import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { ledgerAccess, reconcile, requireAccess } from "@/domain/ledger/service";

type Ctx = { params: Promise<{ id: string }> };

/** ledger.write. POST { familyId } — links an envelope to a family (append-only, audited). */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  requireAccess(await ledgerAccess(s), "write");
  const { familyId } = await parseBody(req, z.object({ familyId: z.string().uuid() }));
  await reconcile(s, id, familyId);
  return json({ ok: true });
});
