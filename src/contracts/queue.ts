import { z } from "zod";

/** Queue entry lifecycle. Mirrors the Postgres enum queue_status. */
export const QueueStatusEnum = z.enum(["waiting", "called", "on_stage", "served", "no_show"]);
export type QueueEntryStatus = z.infer<typeof QueueStatusEnum>;

/**
 * Contract C2 — getQueueStatus(familyId, eventId). Consumer: E2 family pass.
 * Never contains other families' data. `position` is the 1-based place among waiting families
 * (null unless status is "waiting"); `nowServing` is the token currently on the TV.
 */
export const QueueStatusSchema = z.object({
  eventId: z.string().uuid(),
  familyId: z.string().uuid(),
  checkedIn: z.boolean(),
  token: z.number().int().positive().nullable(),
  status: QueueStatusEnum.nullable(),
  position: z.number().int().positive().nullable(),
  nowServing: z.number().int().positive().nullable(),
  paused: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

/** What the venue TV receives. Tokens and instruction only — by construction, no PII. */
export const TvFeedSchema = z.object({
  token: z.number().int().nullable(),
  nextToken: z.number().int().nullable(),
  instruction: z.string().nullable(),
  language: z.enum(["en", "hi"]),
  announcementId: z.string().uuid().nullable(),
  updatedAt: z.string(),
});
export type TvFeed = z.infer<typeof TvFeedSchema>;

/** Check-in success response. */
export const CheckinResultSchema = z.object({
  token: z.number().int().positive(),
  position: z.number().int().positive().nullable(),
  status: QueueStatusEnum,
  familyLink: z.string().url(),
});
export type CheckinResult = z.infer<typeof CheckinResultSchema>;
