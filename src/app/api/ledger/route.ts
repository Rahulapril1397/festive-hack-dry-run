import { handle, json, parseBody } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { AddEntry, Filters, addEntry, ledgerAccess, ledgerView, requireAccess } from "@/domain/ledger/service";

export const dynamic = "force-dynamic";

const filtersFrom = (url: URL) => Filters.parse(Object.fromEntries([...url.searchParams].filter(([, v]) => v !== "")));

/** GET: ledger.read or ledger.write. Without ledger.read there is no `amount` key and no totals. */
export const GET = handle(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  const access = await ledgerAccess(s);
  requireAccess(access, "view");
  return json({ access, ...(await ledgerView(s, access, filtersFrom(new URL(req.url)))) }, { headers: { "cache-control": "no-store" } });
});

/** POST: ledger.write. Adds an immutable entry (+ audit row). */
export const POST = handle(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  requireAccess(await ledgerAccess(s), "write");
  const e = await addEntry(s, await parseBody(req, AddEntry));
  return json({ id: e.id }, 201);
});
