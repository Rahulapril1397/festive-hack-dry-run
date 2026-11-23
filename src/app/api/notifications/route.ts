import { handle, json, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/authz";
import { listNotifications } from "@/lib/jobs/notifications";

export const dynamic = "force-dynamic";

/** Signed-in staff: their own notifications in the selected wedding. */
export const GET = handle(async () => {
  publicRoute("signed-in user; only notifications addressed to their own user id");
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  if (s.status !== "active") throw new AppError("FORBIDDEN");
  return json(await listNotifications(s.userId, s.weddingId), { headers: { "cache-control": "no-store" } });
});
