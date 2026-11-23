import { z } from "zod";
import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { markRead } from "@/lib/jobs/notifications";

export const dynamic = "force-dynamic";

/** Mark some (ids) or all of the caller's notifications read. */
export const POST = handle(async (req: Request) => {
  publicRoute("signed-in user; updates only rows addressed to their own user id");
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(200).optional() }));
  return json({ updated: await markRead(s.userId, s.weddingId, ids) });
});
