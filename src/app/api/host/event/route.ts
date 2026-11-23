import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { CreateEvent, createEvent } from "@/domain/host/queries";

/** event.write. Create a function (also creates pending RSVPs for every family). */
export const POST = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "event.write", s?.weddingId ?? "");
  const e = await createEvent(ctx, await parseBody(req, CreateEvent));
  return json({ id: e.id }, 201);
});
