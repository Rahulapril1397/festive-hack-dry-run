import { z } from "zod";

/** PUT /api/guest/rsvp body. Not attending → headcount forced to 0; attending → 1..10. */
export const RsvpItem = z
  .object({
    eventId: z.string().uuid(),
    attending: z.boolean(),
    headcount: z.number().int().min(0).max(10),
  })
  .refine((r) => !r.attending || r.headcount >= 1, { message: "Attending needs at least 1 guest", path: ["headcount"] })
  .transform((r) => ({ ...r, headcount: r.attending ? r.headcount : 0 }));

export const RsvpInput = z
  .object({ rsvps: z.array(RsvpItem).min(1).max(20) })
  .refine((b) => new Set(b.rsvps.map((r) => r.eventId)).size === b.rsvps.length, { message: "Duplicate eventId" });

export type RsvpInputT = z.infer<typeof RsvpInput>;
