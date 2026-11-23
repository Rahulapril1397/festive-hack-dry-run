import { handle, json } from "@/lib/http";
import { getSession, requireAnyPermission } from "@/lib/authz";
import { listEvents } from "@/lib/db/service";

/** Events (functions) of the selected wedding — any operational screen permission. */
export const GET = handle(async () => {
  const s = await getSession();
  const ctx = await requireAnyPermission(s, ["host.read", "queue.read", "kitchen.read", "photos.upload", "ledger.write", "ledger.read"], s?.weddingId ?? "");
  return json({ events: await listEvents(ctx.weddingId) });
});
