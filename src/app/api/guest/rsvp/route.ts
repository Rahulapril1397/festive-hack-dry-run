import { handle, json, parseBody } from "@/lib/http";
import { RsvpInput } from "@/domain/rsvp/schema";
import { guestFromCookie, saveRsvps } from "@/domain/rsvp/service";

/** Guest (signed family cookie). PUT { rsvps: [{ eventId, attending, headcount }] } — one transaction. */
export const PUT = handle(async (req: Request) => {
  const g = await guestFromCookie();
  const input = await parseBody(req, RsvpInput);
  return json({ rsvps: await saveRsvps(g.family.id, input) });
});
