import { handle, json, parseBody } from "@/lib/http";
import { VerifyInput, verifyAndJoin } from "@/domain/checkin/service";

/** Public. POST { phone, code, eventId } → { token, position, status, familyLink } */
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, VerifyInput);
  return json(await verifyAndJoin(input));
});
