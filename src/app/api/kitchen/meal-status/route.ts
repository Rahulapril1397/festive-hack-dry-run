import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { rpc } from "@/lib/db/service";

/** kitchen.write. POST { eventId, status } */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, z.object({ eventId: z.string().uuid(), status: z.enum(["not_started", "serving", "closed"]) }));
  const { session } = await authorizeEvent(body.eventId, "kitchen.write");
  return json(await rpc("meal_status_set", { p_event: body.eventId, p_actor: session.userId, p_status: body.status }));
});
