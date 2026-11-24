import { describe, expect, it } from "vitest";
import { arrivalSlots, dayTotals, foodSplit, housekeeping, pickupPoint, roomsNeeded, vehiclePlan, withDefaults } from "@/domain/planning/calc";

const S = withDefaults({});

describe("rooms", () => {
  it("a room takes 6; families stay together", () => {
    expect([0, 1, 5, 6, 7, 12, 13].map((n) => roomsNeeded(n, 6))).toEqual([0, 1, 1, 1, 2, 2, 3]);
  });
});

describe("housekeeping recommendations", () => {
  it("mattresses are people beyond the beds; cleaners and tea staff come from the ratios", () => {
    // 10 rooms, 2 beds each = 20 beds; 50 people in them -> 30 mattresses; 150 guests / 40 -> 4 tea staff
    expect(housekeeping({ roomsOccupied: 10, peopleInRooms: 50, peakGuests: 150 }, S)).toEqual({ roomsOccupied: 10, mattresses: 30, cleaners: 1, teaWater: 4 });
  });
  it("never goes negative and is zero with nothing to serve", () => {
    expect(housekeeping({ roomsOccupied: 0, peopleInRooms: 0, peakGuests: 0 }, S)).toEqual({ roomsOccupied: 0, mattresses: 0, cleaners: 0, teaWater: 0 });
    expect(housekeeping({ roomsOccupied: 3, peopleInRooms: 2, peakGuests: 1 }, S).mattresses).toBe(0);
  });
  it("cleaners round up per 15 rooms", () => {
    expect(housekeeping({ roomsOccupied: 16, peopleInRooms: 0, peakGuests: 0 }, S).cleaners).toBe(2);
  });
});

describe("vehicle plan", () => {
  it("adds the buffer, uses big vehicles first, then the smallest that fits the rest", () => {
    // 25 people + 10% = 28 seats: 2 x 12 = 24, left 4 -> a sedan (4)
    const p = vehiclePlan(25, S.vehicles, 0.1);
    expect(p.seatsNeeded).toBe(28);
    expect(p.vehicles).toEqual([{ name: "Tempo traveller", capacity: 12, count: 2 }, { name: "Sedan", capacity: 4, count: 1 }]);
    expect(p.seats).toBe(28);
  });
  it("covers the people with a single small vehicle when that is enough", () => {
    expect(vehiclePlan(3, S.vehicles, 0).vehicles).toEqual([{ name: "Sedan", capacity: 4, count: 1 }]);
  });
  it("is empty for nobody", () => {
    expect(vehiclePlan(0, S.vehicles, 0.1)).toMatchObject({ seatsNeeded: 0, vehicles: [], seats: 0 });
  });
  it("always has at least as many seats as needed", () => {
    for (let n = 1; n <= 80; n++) expect(vehiclePlan(n, S.vehicles, 0.1).seats).toBeGreaterThanOrEqual(Math.ceil(n * 1.1));
  });
});

describe("arrivals by day and hour (India time)", () => {
  const a = (id: string, people: number, mode: string | null, at: string) => ({ familyId: id, family: id, people, mode, number: null, arrivalAt: at });
  const slots = arrivalSlots([
    a("A", 4, "train", "2026-12-11T12:40:00Z"), // 18:10 IST
    a("B", 3, "flight", "2026-12-11T12:55:00Z"), // 18:25 IST
    a("C", 2, null, "2026-12-11T19:00:00Z"), // 00:30 IST on the 12th
  ]);
  it("groups by IST hour in time order", () => {
    expect(slots.map((s) => [s.day, s.hour, s.people])).toEqual([["2026-12-11", 18, 7], ["2026-12-12", 0, 2]]);
    expect(slots[0]!.byMode).toEqual({ train: 4, flight: 3 });
    expect(slots[1]!.byMode).toEqual({ "not given": 2 });
  });
  it("adds up per day", () => {
    expect(dayTotals(slots).map((d) => [d.day, d.people, d.families])).toEqual([["2026-12-11", 7, 2], ["2026-12-12", 2, 1]]);
  });
});

describe("pickup point and food split", () => {
  const w = { stationName: "Jaipur Junction", airportName: "Jaipur Airport" };
  it("train → station, flight → airport, otherwise none", () => {
    expect(pickupPoint("train", w)).toBe("Jaipur Junction");
    expect(pickupPoint("flight", w)).toBe("Jaipur Airport");
    expect(pickupPoint("car", w)).toBeNull();
    expect(pickupPoint(null, w)).toBeNull();
  });
  it("counts people by food, unknown as not stated", () => {
    expect(foodSplit([{ people: 4, food: "veg" }, { people: 2, food: "jain" }, { people: 3, food: null }, { people: 1, food: "weird" }])).toEqual({ veg: 4, non_veg: 0, jain: 2, vegan: 0, "not stated": 4 });
  });
});

describe("settings", () => {
  it("fills defaults and rejects nonsense", () => {
    expect(withDefaults(null).roomCapacity).toBe(6);
    expect(withDefaults({ roomCapacity: 4 }).roomCapacity).toBe(4);
    expect(() => withDefaults({ roomCapacity: 0 })).toThrow();
    expect(() => withDefaults({ vehicles: [] })).toThrow();
  });
});
