import { handle, json } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { autoallocateRooms } from "@/domain/planning/service";

/** planning.write. POST → gives every attending family without a room whole rooms (6 per room by default). Families that do not fit are listed, not partly placed. */
export const POST = handle(async () => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  return json(await autoallocateRooms(ctx.weddingId, ctx.userId));
});
