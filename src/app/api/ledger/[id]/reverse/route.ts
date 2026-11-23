import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { ledgerAccess, requireAccess, reverseEntry } from "@/domain/ledger/service";

type Ctx = { params: Promise<{ id: string }> };

/** ledger.write. Corrections: reverse, then add a new entry. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  requireAccess(await ledgerAccess(s), "write");
  const { notes } = await parseBody(req, z.object({ notes: z.string().trim().max(500).nullable().optional() }));
  const r = await reverseEntry(s, id, notes ?? null);
  return json({ id: r.id }, 201);
});
