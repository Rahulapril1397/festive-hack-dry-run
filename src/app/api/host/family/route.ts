import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { AddFamily, addFamily } from "@/domain/host/queries";

/** family.write. Returns the one-time 4-digit check-in code and the family link key. */
export const POST = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "family.write", s?.weddingId ?? "");
  return json(await addFamily(ctx, await parseBody(req, AddFamily)), 201);
});
