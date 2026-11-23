import { handle, json, parseBody } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { ParticipantPatch } from "@/contracts/people";
import { upsertPerson } from "@/domain/people/service";

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  return json(await upsertPerson(s, (await params).id, await parseBody(req, ParticipantPatch)));
});
