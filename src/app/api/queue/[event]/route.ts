import { handle, json } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { getQueueSnapshot } from "@/domain/queue/service";

type Ctx = { params: Promise<{ event: string }> };

/** Staff (queue.read). Console snapshot: waiting list with names, paused flag, recent actions. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { event } = await params;
  await authorizeEvent(event, "queue.read");
  return json(await getQueueSnapshot(event), { headers: { "cache-control": "no-store" } });
});
