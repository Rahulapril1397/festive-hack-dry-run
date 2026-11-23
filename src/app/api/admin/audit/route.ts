import { handle, json } from "@/lib/http";
import { AuditQuery } from "@/contracts/admin";
import { requireAdmin } from "@/domain/admin/guard";
import { auditPage } from "@/domain/admin/service";

export const dynamic = "force-dynamic";

/** audit.read. Cursor pagination (newest first); scope=all for super admins. */
export const GET = handle(async (req: Request) => {
  const s = await requireAdmin("audit.read");
  const q = AuditQuery.parse(Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== "")));
  return json(await auditPage(s, q), { headers: { "cache-control": "no-store" } });
});
