import { handle, json, parseBody } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { DeskInput, deskJoin } from "@/domain/checkin/service";

/** Staff (queue.checkin). Check in an existing family found via lookup. POST { eventId, familyId } */
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, DeskInput);
  const { session } = await authorizeEvent(input.eventId, "queue.checkin");
  return json(await deskJoin(input, session.userId));
});
