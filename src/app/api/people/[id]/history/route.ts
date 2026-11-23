import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { personHistory } from "@/domain/people/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  return json({ entries: await personHistory(s.weddingId, (await params).id) }, { headers: { "cache-control": "no-store" } });
});
