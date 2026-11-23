import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { ParticipantInput } from "@/contracts/people";
import { listPeople, listWeddingRoles, upsertPerson } from "@/domain/people/service";

export const dynamic = "force-dynamic";

/** users.manage: everyone working on the selected wedding, with or without a login. */
export const GET = handle(async () => {
  const s = await requireAdmin("users.manage");
  const [people, roles] = await Promise.all([listPeople(s.weddingId), listWeddingRoles(s.weddingId)]);
  return json({ people, roles }, { headers: { "cache-control": "no-store" } });
});

export const POST = handle(async (req: Request) => {
  const s = await requireAdmin("users.manage");
  return json(await upsertPerson(s, null, await parseBody(req, ParticipantInput)), 201);
});
