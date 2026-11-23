import { handle, json, parseBody } from "@/lib/http";
import { CreateWeddingInput } from "@/contracts/admin";
import { requireAdmin } from "@/domain/admin/guard";
import { createWedding } from "@/domain/admin/service";

/** weddings.manage (super admin): wedding + its events + a host assignment, no seed data. */
export const POST = handle(async (req: Request) => {
  const s = await requireAdmin("weddings.manage");
  return json(await createWedding(s, await parseBody(req, CreateWeddingInput)), 201);
});
