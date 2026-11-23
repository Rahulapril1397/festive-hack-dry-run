import { z } from "zod";
import { handle, json } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { lookup } from "@/domain/checkin/service";

const Query = z.object({ eventId: z.string().uuid(), q: z.string().trim().min(1).max(40) });

/** Staff (queue.checkin). GET ?eventId&q= — by name, phone digits or token number. */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const { eventId, q } = Query.parse(Object.fromEntries(url.searchParams));
  await authorizeEvent(eventId, "queue.checkin");
  return json({ results: await lookup(eventId, q) });
});
