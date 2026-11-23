import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { RsvpInput } from "@/domain/rsvp/schema";
import { guestFromCookie, saveRsvps } from "@/domain/rsvp/service";

/** Guest (signed family cookie). PUT { rsvps: [{ eventId, attending, headcount }] } — one transaction. */
export const PUT = handle(async (req: Request) => {
  publicRoute("guest family cookie (HMAC-signed link key), own family only");
  const g = await guestFromCookie();
  const input = await parseBody(req, RsvpInput);
  return json({ rsvps: await saveRsvps(g.family.id, input) });
});
