import { handle, idempotencyKey, json } from "@/lib/http";
import { authorizeEvent } from "@/lib/authz/event";
import { callNext } from "@/domain/queue/service";

type Ctx = { params: Promise<{ event: string }> };

/**
 * POST /api/queue/:event/call-next  (header Idempotency-Key, permission queue.call_next)
 * 200 { logId, entryId, token }; replaying a key returns the original call.
 * 409 QUEUE_PAUSED | QUEUE_EMPTY | IDEMPOTENCY_CONFLICT.
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { event } = await params;
  const key = idempotencyKey(req);
  const { session } = await authorizeEvent(event, "queue.call_next");
  const log = await callNext(event, session.userId, key);
  return json({ logId: log.id, entryId: log.queue_entry_id, token: log.token_number, at: log.created_at });
});
