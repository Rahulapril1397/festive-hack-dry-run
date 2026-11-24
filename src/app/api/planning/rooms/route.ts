import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { CreateRoomsInput } from "@/contracts/planning";
import { createRooms } from "@/domain/planning/service";

/** planning.write. POST { block, floor?, prefix, from, to, capacity, beds } → creates rooms from..to (existing labels are skipped). */
export const POST = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  return json(await createRooms(ctx.weddingId, await parseBody(req, CreateRoomsInput)), 201);
});
