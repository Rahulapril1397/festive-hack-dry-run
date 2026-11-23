import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { ledgerAccess, requireAccess, searchFamilies } from "@/domain/ledger/service";

/** ledger.write. Family picker for entries and reconciliation: name or token number. No phones. */
export const GET = handle(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  requireAccess(await ledgerAccess(s), "write");
  return json({ families: await searchFamilies(s.weddingId, new URL(req.url).searchParams.get("q") ?? "") });
});
