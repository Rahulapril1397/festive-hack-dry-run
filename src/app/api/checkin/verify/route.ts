import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { VerifyInput, verifyAndJoin } from "@/domain/checkin/service";

/** Public. POST { phone, code, eventId } → { token, position, status, familyLink } */
export const POST = handle(async (req: Request) => {
  publicRoute("guest check-in: phone + 4-digit code, persisted 5-failures-in-15-min lockout");
  const input = await parseBody(req, VerifyInput);
  return json(await verifyAndJoin(input));
});
