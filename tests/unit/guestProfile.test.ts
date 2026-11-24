import { describe, expect, it } from "vitest";
import { ProfileInput } from "@/domain/rsvp/schema";
import { shapeGuests } from "@/lib/assistant/tools/guests";

const ok = { travelMode: "train", travelNumber: "12951", arrivalAt: "2026-12-11T18:30", arrivingCount: 4, foodPref: "jain", foodNote: "peanut allergy" };

describe("guest profile input", () => {
  it("accepts a full answer", () => {
    expect(ProfileInput.parse(ok)).toEqual(ok);
  });
  it("treats blank fields as empty, so every field is optional", () => {
    const r = ProfileInput.parse({ travelMode: "", travelNumber: "  ", arrivalAt: "", arrivingCount: "", foodPref: "", foodNote: "" });
    expect(r).toEqual({ travelMode: null, travelNumber: null, arrivalAt: null, arrivingCount: null, foodPref: null, foodNote: null });
  });
  it("rejects unknown modes and foods, odd characters, huge counts and long notes", () => {
    expect(ProfileInput.safeParse({ ...ok, travelMode: "rocket" }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, foodPref: "fruitarian" }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, travelNumber: "AI<101>" }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, travelNumber: "A".repeat(13) }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, arrivingCount: 31 }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, arrivingCount: -1 }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, foodNote: "x".repeat(201) }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, arrivalAt: "tomorrow evening" }).success).toBe(false);
  });
  it("rejects unknown keys' effect: only the six fields survive", () => {
    expect(Object.keys(ProfileInput.parse({ ...ok, phone: "9876543210" })).sort()).toEqual(["arrivalAt", "arrivingCount", "foodNote", "foodPref", "travelMode", "travelNumber"]);
  });
});

describe("admin guest lookup shows trip and food, never contact details", () => {
  const fam = [{ id: "f1", name: "Verma family", token_number: 7, language: "ta" }, { id: "f2", name: "Iyer family", token_number: null, language: "hi" }];
  const out = shapeGuests(fam, [], [], [], [{ family_id: "f1", travel_mode: "flight", travel_number: "AI101", arrival_at: "2026-12-11T13:00:00Z", arriving_count: 3, food_pref: "veg", food_note: null }]);
  it("shapes the family that answered", () => {
    expect(out[0]!.travel).toMatchObject({ mode: "flight", number: "AI101", people: 3 });
    expect(out[0]!.food).toEqual({ preference: "veg", note: null });
  });
  it("leaves families that have not answered empty", () => {
    expect(out[1]!.travel).toBeNull();
    expect(out[1]!.food).toBeNull();
  });
  it("has no phone, link or code keys", () => {
    expect(JSON.stringify(out)).not.toMatch(/phone|link|code/i);
  });
});
