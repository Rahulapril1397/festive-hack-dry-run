import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { QueueStatusSchema, QueueStatusEnum, TvFeedSchema, type QueueStatus, type TvFeed } from "@/contracts/queue";

export type StageLogRow = {
  id: string;
  event_id: string;
  queue_entry_id: string | null;
  token_number: number | null;
  action: "called" | "skipped" | "paused" | "resumed" | "on_stage" | "served" | "no_show";
  actor: string | null;
  idempotency_key: string;
  created_at: string;
};

export const ENTRY_ACTIONS = ["skip", "on_stage", "served", "no_show", "pause", "resume"] as const;
export type QueueActionName = (typeof ENTRY_ACTIONS)[number];

const ACTION_TO_LOG: Record<QueueActionName, StageLogRow["action"]> = {
  skip: "skipped",
  on_stage: "on_stage",
  served: "served",
  no_show: "no_show",
  pause: "paused",
  resume: "resumed",
};

export async function callNext(eventId: string, actorId: string, idemKey: string): Promise<StageLogRow> {
  return rpc<StageLogRow>("call_next", { p_event: eventId, p_actor: actorId, p_idem: idemKey });
}

export async function queueAction(
  eventId: string,
  actorId: string,
  idemKey: string,
  action: QueueActionName,
  entryId: string | null,
): Promise<StageLogRow> {
  const needsEntry = action !== "pause" && action !== "resume";
  if (needsEntry && !entryId) throw new AppError("BAD_REQUEST", "entryId is required");
  return rpc<StageLogRow>("queue_action", {
    p_event: eventId,
    p_actor: actorId,
    p_idem: idemKey,
    p_action: ACTION_TO_LOG[action],
    p_entry: needsEntry ? entryId : null,
  });
}

/** Contract C2. Safe to show to the family itself. */
export async function getQueueStatus(familyId: string, eventId: string): Promise<QueueStatus> {
  const raw = await rpc<unknown>("get_queue_status", { p_family: familyId, p_event: eventId });
  return QueueStatusSchema.parse(raw);
}

export const QueueSnapshotSchema = z.object({
  eventId: z.string(),
  paused: z.boolean(),
  currentEntryId: z.string().nullable(),
  entries: z.array(
    z.object({
      entryId: z.string(),
      token: z.number(),
      familyName: z.string(),
      isWalkIn: z.boolean(),
      status: QueueStatusEnum,
      skipCount: z.number(),
      calledAt: z.string().nullable(),
    }),
  ),
  counts: z.record(z.number()).nullable(),
  recent: z.array(z.object({ id: z.string(), action: z.string(), token: z.number().nullable(), at: z.string() })),
});
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;

/** Staff-only view: includes family names. Never route this to the TV. */
export async function getQueueSnapshot(eventId: string): Promise<QueueSnapshot> {
  return QueueSnapshotSchema.parse(await rpc<unknown>("queue_snapshot", { p_event: eventId }));
}

/** TV feed: selects only the whitelisted columns. */
export async function getTvFeed(eventId: string): Promise<TvFeed | null> {
  const { data, error } = await db()
    .from("tv_feed")
    .select("token, next_token, instruction, language, announcement_id, updated_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return TvFeedSchema.parse({
    token: data.token,
    nextToken: data.next_token,
    instruction: data.instruction,
    language: data.language,
    announcementId: data.announcement_id,
    updatedAt: data.updated_at,
  });
}

/** Resolve an event by id + TV key (constant-time compare). Returns null on mismatch. */
export async function eventForTvKey(eventId: string, key: string | null): Promise<{ id: string; name: string } | null> {
  if (!key || !z.string().uuid().safeParse(eventId).success) return null;
  const { data } = await db().from("event").select("id, name, tv_key").eq("id", eventId).maybeSingle();
  if (!data) return null;
  const a = Buffer.from(String(data.tv_key));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b) ? { id: data.id, name: data.name } : null;
}
