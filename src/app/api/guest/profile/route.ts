import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimit";
import { guestFromCookie, saveProfile } from "@/domain/rsvp/service";
import { ProfileInput } from "@/domain/rsvp/schema";

/** Guest. PUT { travelMode, travelNumber, arrivalAt, arrivingCount, foodPref, foodNote } → the family's own trip and food answers. */
export const PUT = handle(async (req: Request) => {
  publicRoute("guest family cookie (HMAC-signed link key), own family only");
  const g = await guestFromCookie();
  if (!rateLimit(`profile:${g.family.id}`, 20, 60_000)) throw new AppError("RATE_LIMITED", "Too many updates — please wait a moment");
  const input = await parseBody(req, ProfileInput);
  return json(await saveProfile(g.family.id, input));
});
