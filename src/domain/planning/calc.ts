import { z } from "zod";

/** Pure planning maths (no I/O, unit-tested): rooms, housekeeping, vehicles, arrival slots. */

export const Vehicle = z.object({ name: z.string().trim().min(1).max(30), capacity: z.number().int().min(1).max(60) });
export const PlanSettings = z.object({
  roomCapacity: z.number().int().min(1).max(20).default(6),
  bedsPerRoom: z.number().int().min(0).max(20).default(2),
  roomsPerCleaner: z.number().int().min(1).max(200).default(15),
  guestsPerTeaStaff: z.number().int().min(1).max(500).default(40),
  vehicleBuffer: z.number().min(0).max(1).default(0.1),
  vehicles: z.array(Vehicle).min(1).max(6).default([
    { name: "Sedan", capacity: 4 },
    { name: "SUV / Innova", capacity: 6 },
    { name: "Tempo traveller", capacity: 12 },
  ]),
});
export type PlanSettingsT = z.infer<typeof PlanSettings>;

/** Stored settings may be empty or partial: fill every missing field with its default. */
export const withDefaults = (raw: unknown): PlanSettingsT => PlanSettings.parse(raw && typeof raw === "object" ? raw : {});

/** Whole rooms a family needs. People count the same whatever their age (we do not know gender, so families stay together). */
export const roomsNeeded = (people: number, capacity: number) => (people <= 0 ? 0 : Math.ceil(people / capacity));

export type Housekeeping = { roomsOccupied: number; mattresses: number; cleaners: number; teaWater: number };

/** Recommendations from editable ratios. Mattresses = people beyond the beds in the occupied rooms. */
export function housekeeping(opts: { roomsOccupied: number; peopleInRooms: number; peakGuests: number }, s: PlanSettingsT): Housekeeping {
  const beds = opts.roomsOccupied * s.bedsPerRoom;
  return {
    roomsOccupied: opts.roomsOccupied,
    mattresses: Math.max(0, opts.peopleInRooms - beds),
    cleaners: opts.roomsOccupied === 0 ? 0 : Math.ceil(opts.roomsOccupied / s.roomsPerCleaner),
    teaWater: opts.peakGuests === 0 ? 0 : Math.ceil(opts.peakGuests / s.guestsPerTeaStaff),
  };
}

export type VehiclePlan = { people: number; seatsNeeded: number; vehicles: { name: string; count: number; capacity: number }[]; seats: number };

/** Fewest vehicles for `people` plus the buffer: biggest vehicles first, then the smallest one that fits the rest. */
export function vehiclePlan(people: number, vehicles: readonly { name: string; capacity: number }[], buffer: number): VehiclePlan {
  const seatsNeeded = people <= 0 ? 0 : Math.ceil(people * (1 + buffer));
  const sorted = [...vehicles].sort((a, b) => b.capacity - a.capacity);
  const out: VehiclePlan["vehicles"] = [];
  let left = seatsNeeded;
  const big = sorted[0];
  if (big && left > 0) {
    const n = Math.floor(left / big.capacity);
    if (n > 0) out.push({ ...big, count: n });
    left -= n * big.capacity;
  }
  if (left > 0) {
    const fit = [...sorted].reverse().find((v) => v.capacity >= left) ?? big;
    if (fit) {
      const existing = out.find((o) => o.name === fit.name);
      if (existing) existing.count += 1;
      else out.push({ ...fit, count: 1 });
    }
  }
  return { people, seatsNeeded, vehicles: out, seats: out.reduce((n, v) => n + v.count * v.capacity, 0) };
}

const IST_MS = 5.5 * 3600_000;
const istParts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + IST_MS);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};

export type Arrival = { familyId: string; family: string; people: number; mode: string | null; number: string | null; arrivalAt: string };
export type Slot = { day: string; hour: number; people: number; families: number; byMode: Record<string, number>; items: Arrival[] };

/** Arrivals grouped by India day and hour, in time order. Families with no mode count as "not given". */
export function arrivalSlots(arrivals: readonly Arrival[]): Slot[] {
  const map = new Map<string, Slot>();
  for (const a of arrivals) {
    const { day, hour } = istParts(a.arrivalAt);
    const key = `${day}T${String(hour).padStart(2, "0")}`;
    const s = map.get(key) ?? { day, hour, people: 0, families: 0, byMode: {}, items: [] };
    s.people += a.people;
    s.families += 1;
    const m = a.mode ?? "not given";
    s.byMode[m] = (s.byMode[m] ?? 0) + a.people;
    s.items.push(a);
    map.set(key, s);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s);
}

export type DayTotal = { day: string; people: number; families: number; byMode: Record<string, number> };
export function dayTotals(slots: readonly Slot[]): DayTotal[] {
  const days = new Map<string, DayTotal>();
  for (const s of slots) {
    const d = days.get(s.day) ?? { day: s.day, people: 0, families: 0, byMode: {} };
    d.people += s.people;
    d.families += s.families;
    for (const [m, n] of Object.entries(s.byMode)) d.byMode[m] = (d.byMode[m] ?? 0) + n;
    days.set(s.day, d);
  }
  return [...days.values()];
}

/** The pickup point a family is met at, from how it travels. Null for car, bus or unknown. */
export function pickupPoint(mode: string | null, w: { stationName: string | null; airportName: string | null }): string | null {
  if (mode === "train") return w.stationName;
  if (mode === "flight") return w.airportName;
  return null;
}

export type FoodSplit = Record<"veg" | "non_veg" | "jain" | "vegan" | "not stated", number>;
export function foodSplit(rows: readonly { people: number; food: string | null }[]): FoodSplit {
  const out: FoodSplit = { veg: 0, non_veg: 0, jain: 0, vegan: 0, "not stated": 0 };
  for (const r of rows) {
    const k = (r.food && r.food in out ? r.food : "not stated") as keyof FoodSplit;
    out[k] += r.people;
  }
  return out;
}
