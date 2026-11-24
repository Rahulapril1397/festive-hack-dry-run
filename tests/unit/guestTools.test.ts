import { describe, expect, it } from "vitest";
import { likePattern, matchFunction, parseGuestQuery, shapeGuests } from "@/lib/assistant/tools/guests";
import { TOOLS } from "@/lib/assistant/tools";

const events = [
  { id: "e1", name: "Haldi" },
  { id: "e2", name: "Sangeet" },
  { id: "e3", name: "Reception" },
];

describe("guest lookup helpers", () => {
  it("a number is a token, text is a name, empty is nothing", () => {
    expect(parseGuestQuery("12")).toEqual({ token: 12 });
    expect(parseGuestQuery(" Sharma ")).toEqual({ name: "Sharma" });
    expect(parseGuestQuery("Dr. Sharma 2")).toEqual({ name: "Dr. Sharma 2" });
    expect(parseGuestQuery("")).toBeNull();
    expect(parseGuestQuery(undefined)).toBeNull();
    expect(parseGuestQuery("1234567")).toEqual({ name: "1234567" }); // too long for a token
  });
  it("name search is a plain substring match (wildcards escaped)", () => {
    expect(likePattern("Sharma")).toBe("%Sharma%");
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });
  it("shapes RSVP per function with guest counts, check-ins, and never a phone or link key", () => {
    const rows = shapeGuests(
      [{ id: "f1", name: "Sharma family", token_number: 7, language: "hi" }, { id: "f2", name: "Iyer family", token_number: null, language: "ta" }],
      [
        { family_id: "f1", event_id: "e1", status: "yes", headcount: 4 },
        { family_id: "f1", event_id: "e2", status: "no", headcount: 0 },
      ],
      [{ family_id: "f1", event_id: "e3", status: "served" }],
      events,
    );
    expect(rows[0]).toEqual({
      family: "Sharma family",
      token: 7,
      language: "hi",
      rsvp: [
        { function: "Haldi", status: "attending", guests: 4 },
        { function: "Sangeet", status: "not attending", guests: 0 },
        { function: "Reception", status: "no answer yet", guests: 0 },
      ],
      checkedInTo: ["Reception"],
      travel: null,
      food: null,
    });
    expect(rows[1]!.rsvp.every((r) => r.status === "no answer yet")).toBe(true);
    const keys = JSON.stringify(rows);
    for (const secret of ["phone", "link_key", "checkin_code"]) expect(keys).not.toContain(secret);
  });
  it("function names match case-insensitively; unknown names match nothing; empty means all", () => {
    expect(matchFunction(events, "reception")).toEqual([events[2]]);
    expect(matchFunction(events, "wedding")).toEqual([]);
    expect(matchFunction(events, "")).toBeNull();
  });
});

describe("tool registry: the new admin tools", () => {
  const by = (n: string) => TOOLS.find((t) => t.name === n)!;
  it("are read-only and permission-gated", () => {
    expect(by("function_details").write).toBeUndefined();
    expect(by("guest_lookup").write).toBeUndefined();
    expect(by("function_details").access).toEqual({ anyOf: ["host.read"] });
    expect(by("guest_lookup").access).toEqual({ anyOf: ["families.read"] });
  });
  it("reject unknown or oversized arguments", () => {
    expect(by("guest_lookup").input.safeParse({ rsvp: "maybe" }).success).toBe(false);
    expect(by("guest_lookup").input.safeParse({ limit: 500 }).success).toBe(false);
    expect(by("guest_lookup").input.safeParse({ query: "x", extra: 1 }).success).toBe(false);
    expect(by("guest_lookup").input.safeParse({ query: "Sharma", function: "Reception", rsvp: "pending", limit: 5 }).success).toBe(true);
    expect(by("function_details").input.safeParse({ function: "Haldi" }).success).toBe(true);
  });
});
