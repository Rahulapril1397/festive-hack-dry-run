import "server-only";
import { getEvent } from "@/lib/db/service";
import { getSession, requirePermission, type Permission } from "./index";

/** Load the event, then check the caller holds `key` in the event's wedding. */
export async function authorizeEvent(eventId: string, key: Permission) {
  const [session, event] = await Promise.all([getSession(), getEvent(eventId)]);
  const ctx = await requirePermission(session, key, event.wedding_id);
  return { session: ctx, event };
}
