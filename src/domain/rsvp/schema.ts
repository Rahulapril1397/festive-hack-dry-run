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

export const TRAVEL_MODES = ["train", "flight", "car", "bus", "other"] as const;
export const FOOD_PREFS = ["veg", "non_veg", "jain", "vegan"] as const;
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** PUT /api/guest/profile body. Arrival is the guest's local (India) time as YYYY-MM-DDTHH:mm. Every field is optional. */
export const ProfileInput = z.object({
  travelMode: z.preprocess(blank, z.enum(TRAVEL_MODES).nullable()),
  travelNumber: z.preprocess(blank, z.string().trim().max(12).regex(/^[A-Za-z0-9 -]+$/, "Letters, digits, space and dash only").nullable()),
  arrivalAt: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable()),
  arrivingCount: z.preprocess(blank, z.number().int().min(0).max(30).nullable()),
  foodPref: z.preprocess(blank, z.enum(FOOD_PREFS).nullable()),
  foodNote: z.preprocess(blank, z.string().trim().max(200).nullable()),
});
export type ProfileInputT = z.infer<typeof ProfileInput>;
