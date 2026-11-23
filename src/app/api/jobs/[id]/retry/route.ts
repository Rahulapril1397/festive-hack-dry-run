import { handle, json } from "@/lib/http";
import { rpc } from "@/lib/db/service";
import { requireAdmin } from "@/domain/admin/guard";

export const dynamic = "force-dynamic";

/** jobs.manage: put a failed / dead job back in the queue (audited). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("jobs.manage");
  return json(await rpc("jobs_retry", { p_id: (await params).id, p_actor: s.userId, p_wedding: s.weddingId || null }));
});
