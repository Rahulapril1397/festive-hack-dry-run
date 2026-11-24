import "server-only";
import { getEvent } from "@/lib/db/service";
import { getSession, requirePermission, type Permission } from "./index";

/**
 * Load the event, then check the caller holds `key` in the event's wedding. Signed out → 401 first.
 * An event that does not exist is only reported ("not found") to a caller who holds `key` in their
 * selected wedding; everyone else gets 403, so event ids cannot be probed.
 */
export async function authorizeEvent(eventId: string, key: Permission) {
  const session = await getSession();
  await requirePermission(session, key, session?.weddingId ?? "").catch(async (e) => {
    // Lacking the permission in the selected wedding is only final if the event is not found in another wedding they can use.
    if (!session) throw e;
    const event = await getEvent(eventId).catch(() => null);
    if (!event) throw e;
    return requirePermission(session, key, event.wedding_id);
  });
  const event = await getEvent(eventId);
  const ctx = await requirePermission(session, key, event.wedding_id);
  return { session: ctx, event };
}
