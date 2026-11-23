import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/domain/admin/guard";
import { invitePerson } from "@/domain/people/service";

export const dynamic = "force-dynamic";

/** users.manage: send the participant a sign-in invite; pending assignments start working once linked. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireAdmin("users.manage");
  return json(await invitePerson(s, (await params).id));
});
