import { handle } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { Filters, exportCsv, ledgerAccess, requireAccess } from "@/domain/ledger/service";

export const dynamic = "force-dynamic";

/** ledger.read + ledger.export. Server-generated CSV; writes an audit_log row. */
export const GET = handle(async (req: Request) => {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  requireAccess(await ledgerAccess(s), "export");
  const url = new URL(req.url);
  const csv = await exportCsv(s, Filters.parse(Object.fromEntries([...url.searchParams].filter(([, v]) => v !== ""))));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="shagun-ledger-${day}.csv"`, "cache-control": "no-store" },
  });
});
