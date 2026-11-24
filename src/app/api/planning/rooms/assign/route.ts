import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { AssignRoomInput } from "@/contracts/planning";
import { assignRoom } from "@/domain/planning/service";

/** planning.write. PUT { roomId, familyId | null } → the room goes to that family (moved if another had it), or is freed. */
export const PUT = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  const b = await parseBody(req, AssignRoomInput);
  await assignRoom(ctx.weddingId, ctx.userId, b.roomId, b.familyId);
  return json({ ok: true });
});
