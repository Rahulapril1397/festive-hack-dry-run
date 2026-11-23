import { handle, json, parseBody } from "@/lib/http";
import { InviteUserInput } from "@/contracts/admin";
import { requireAdmin, requireSuperAdmin } from "@/domain/admin/guard";
import { inviteUser, listUsers } from "@/domain/admin/service";

export const dynamic = "force-dynamic";

/** users.manage. ?scope=all lists every user (super admin only). */
export const GET = handle(async (req: Request) => {
  const s = await requireAdmin("users.manage");
  const scope = new URL(req.url).searchParams.get("scope") === "all" ? "all" : "wedding";
  if (scope === "all") requireSuperAdmin(s);
  return json({ users: await listUsers(s, scope) }, { headers: { "cache-control": "no-store" } });
});

/** users.manage. Invite by email (optionally with a first role assignment). */
export const POST = handle(async (req: Request) => {
  const s = await requireAdmin("users.manage");
  const input = await parseBody(req, InviteUserInput);
  if (input.weddingId) await requireAdmin("users.manage", input.weddingId);
  return json(await inviteUser(s, input), 201);
});
