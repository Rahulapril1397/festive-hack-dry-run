import { describe, expect, it, vi } from "vitest";
import { RsvpInput } from "@/domain/rsvp/schema";
import { signGuestCookie, verifyGuestCookie } from "@/domain/rsvp/guestCookie";
import { resolveTranslations } from "@/i18n/translate";

const E1 = "00000000-0000-4000-8000-0000000000a1";
const E2 = "00000000-0000-4000-8000-0000000000a2";

describe("RSVP validation", () => {
  it("accepts 1..10 when attending; forces 0 when not", () => {
    const r = RsvpInput.parse({ rsvps: [{ eventId: E1, attending: true, headcount: 10 }, { eventId: E2, attending: false, headcount: 4 }] });
    expect(r.rsvps[1]!.headcount).toBe(0);
  });
  it.each([
    [{ eventId: E1, attending: true, headcount: 0 }],
    [{ eventId: E1, attending: true, headcount: 11 }],
    [{ eventId: E1, attending: true, headcount: -1 }],
    [{ eventId: E1, attending: true, headcount: 2.5 }],
    [{ eventId: "nope", attending: true, headcount: 2 }],
  ])("rejects %j", (row) => {
    expect(RsvpInput.safeParse({ rsvps: [row] }).success).toBe(false);
  });
  it("rejects empty and duplicate events", () => {
    expect(RsvpInput.safeParse({ rsvps: [] }).success).toBe(false);
    const dup = { eventId: E1, attending: true, headcount: 2 };
    expect(RsvpInput.safeParse({ rsvps: [dup, dup] }).success).toBe(false);
  });
});

describe("guest cookie", () => {
  const secret = "s".repeat(32);
  it("round-trips and rejects tampering / other secrets", async () => {
    const c = await signGuestCookie("demo00010000001", secret);
    expect(await verifyGuestCookie(c, secret)).toBe("demo00010000001");
    expect(await verifyGuestCookie(c.replace("demo0001", "demo0002"), secret)).toBeNull();
    expect(await verifyGuestCookie(c, "x".repeat(32))).toBeNull();
    expect(await verifyGuestCookie(undefined, secret)).toBeNull();
    expect(await verifyGuestCookie(c, "")).toBeNull();
  });
});

describe("translation cache", () => {
  it("uses cached rows, translates and stores only misses", async () => {
    const translate = vi.fn(async (s: string) => `HI:${s}`);
    const store = vi.fn(async () => {});
    const out = await resolveTranslations(["Save", "Back", "Save"], {
      loadCached: async () => ({ Save: "सहेजें" }),
      translate,
      store,
    });
    expect(out).toEqual({ Save: "सहेजें", Back: "HI:Back" });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith([{ source: "Back", text: "HI:Back" }]);
  });

  it("Sarvam failing → English, page never blocked; cache errors are tolerated", async () => {
    const out = await resolveTranslations(["Save"], {
      loadCached: async () => Promise.reject(new Error("db down")),
      translate: async () => Promise.reject(new Error("sarvam down")),
      store: async () => Promise.reject(new Error("never")),
    });
    expect(out).toEqual({ Save: "Save" });
  });
});
