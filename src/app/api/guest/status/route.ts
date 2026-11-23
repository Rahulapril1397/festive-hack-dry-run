import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { guestFromCookie } from "@/domain/rsvp/service";
import { getQueueStatus } from "@/domain/queue";

export const dynamic = "force-dynamic";

/** Guest. GET ?eventId → C2 QueueStatus for the cookie's family only. */
export const GET = handle(async (req: Request) => {
  const g = await guestFromCookie();
  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  if (!g.events.some((e) => e.id === eventId)) throw new AppError("EVENT_NOT_FOUND");
  return json(await getQueueStatus(g.family.id, eventId), { headers: { "cache-control": "no-store" } });
});
