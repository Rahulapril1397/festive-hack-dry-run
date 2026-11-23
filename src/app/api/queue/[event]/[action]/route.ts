import { z } from "zod";
import { handle, idempotencyKey, json } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { AppError } from "@/lib/errors";
import { ENTRY_ACTIONS, queueAction, type QueueActionName } from "@/domain/queue/service";

type Ctx = { params: Promise<{ event: string; action: string }> };

const SLUG_TO_ACTION: Record<string, QueueActionName> = {
  skip: "skip",
  "on-stage": "on_stage",
  served: "served",
  "no-show": "no_show",
  pause: "pause",
  resume: "resume",
};

const Body = z.object({ entryId: z.string().uuid().optional() }).default({});

/**
 * POST /api/queue/:event/{skip|on-stage|served|no-show|pause|resume}
 * Header Idempotency-Key, permission queue.manage. Body { entryId } for entry actions.
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { event, action: slug } = await params;
  const action = SLUG_TO_ACTION[slug];
  if (!action || !ENTRY_ACTIONS.includes(action)) throw new AppError("BAD_REQUEST", `Unknown action ${slug}`);
  const key = idempotencyKey(req);
  const text = await req.text();
  let raw: unknown = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("BAD_REQUEST", "Body must be JSON");
  }
  const body = Body.parse(raw);
  const { session } = await authorizeEvent(event, "queue.manage");
  const log = await queueAction(event, session.userId, key, action, body.entryId ?? null);
  return json({ logId: log.id, action: log.action, entryId: log.queue_entry_id, token: log.token_number });
});
