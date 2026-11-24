import { handle, json } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { clearRooms } from "@/domain/planning/service";

/** planning.write. POST → frees every room (audited). */
export const POST = handle(async () => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  return json({ freed: await clearRooms(ctx.weddingId, ctx.userId) });
});
