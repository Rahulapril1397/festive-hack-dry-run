import { handle, json } from "@/lib/http";
import { getSession } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { listEvents } from "@/lib/db/service";

/** Events of the signed-in user's wedding. */
export const GET = handle(async () => {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  return json({ events: await listEvents(s.weddingId) });
});
