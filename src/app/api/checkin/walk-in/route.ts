import { handle, json, parseBody } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { WalkInInput, walkIn } from "@/domain/checkin/service";

/** Staff (queue.checkin). POST { eventId, name, phone?, language } */
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, WalkInInput);
  const { session } = await authorizeEvent(input.eventId, "queue.checkin");
  return json(await walkIn(input, session.userId), 201);
});
