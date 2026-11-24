import { z } from "zod";
import { Vehicle } from "@/domain/planning/calc";

/** Planning API bodies (planning.write unless noted). */
export const CreateRoomsInput = z
  .object({
    block: z.string().trim().max(40).default(""),
    floor: z.string().trim().max(20).optional(),
    prefix: z.string().trim().max(10).default(""),
    from: z.number().int().min(0).max(9999),
    to: z.number().int().min(0).max(9999),
    capacity: z.number().int().min(1).max(20).default(6),
    beds: z.number().int().min(0).max(20).default(2),
  })
  .refine((r) => r.to >= r.from && r.to - r.from < 200, { message: "Give a range of up to 200 rooms", path: ["to"] });
export type CreateRoomsInput = z.infer<typeof CreateRoomsInput>;

/** roomId + familyId puts the room with the family (moving it if taken); familyId null frees the room. */
export const AssignRoomInput = z.object({ roomId: z.string().uuid(), familyId: z.string().uuid().nullable() });

export const SettingsInput = z.object({
  venueName: z.string().trim().max(120).nullable().optional(),
  venueCity: z.string().trim().max(80).nullable().optional(),
  stationName: z.string().trim().max(120).nullable().optional(),
  airportName: z.string().trim().max(120).nullable().optional(),
  roomCapacity: z.number().int().min(1).max(20).optional(),
  bedsPerRoom: z.number().int().min(0).max(20).optional(),
  roomsPerCleaner: z.number().int().min(1).max(200).optional(),
  guestsPerTeaStaff: z.number().int().min(1).max(500).optional(),
  vehicleBuffer: z.number().min(0).max(1).optional(),
  vehicles: z.array(Vehicle).min(1).max(6).optional(),
});
export type SettingsInput = z.infer<typeof SettingsInput>;

/** driver null clears the assignment. Phone is a 10-digit Indian mobile number. */
export const PickupInput = z.object({
  familyId: z.string().uuid(),
  driver: z
    .object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().transform((v) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number")),
      vehicle: z.string().trim().max(40).optional(),
      vendorId: z.string().uuid().nullable().optional(),
    })
    .nullable(),
});
export type PickupInput = z.infer<typeof PickupInput>;

/** Link (or unlink with null) the login a vendor signs in with. */
export const VendorLoginInput = z.object({ vendorId: z.string().uuid(), email: z.string().trim().toLowerCase().email().nullable() });
