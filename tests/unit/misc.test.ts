import { describe, expect, it } from "vitest";
import { normalizePhone, isCheckinCode } from "@/domain/checkin/phone";
import { clockPayload, verifyClockQr } from "@/lib/clock";
import { roleHas, DEFAULT_ROLE_PERMISSIONS as STATIC_ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/authz/staticMap";
import { QueueStatusSchema, TvFeedSchema } from "@/contracts/queue";

describe("phone normalisation", () => {
  it.each([
    ["9876500001", "9876500001"],
    ["+91 98765-00001", "9876500001"],
    ["098765 00001", "9876500001"],
    ["919876500001", "9876500001"],
    ["12345", null],
    ["5876500001", null],
  ])("%s → %s", (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });
  it("codes are exactly 4 digits", () => {
    expect(isCheckinCode("1234")).toBe(true);
    expect(isCheckinCode("123")).toBe(false);
    expect(isCheckinCode("12a4")).toBe(false);
  });
});

describe("clock QR (C4)", () => {
  const secret = "test-secret-0123456789";
  it("round-trips and rejects tampering", () => {
    const p = clockPayload(1767225600000, secret);
    expect(p.qr).toBe(`PA|1767225600000|${p.sig}`);
    expect(verifyClockQr(p.qr, secret)).toBe(1767225600000);
    expect(verifyClockQr(p.qr.replace("1767225600000", "1767225600001"), secret)).toBeNull();
    expect(verifyClockQr(p.qr, "other-secret-0123456789")).toBeNull();
  });
});

describe("static permission map", () => {
  it("stage can call and manage; kitchen cannot", () => {
    expect(roleHas("stage_manager", "queue.call_next")).toBe(true);
    expect(roleHas("stage_manager", "queue.manage")).toBe(true);
    expect(roleHas("kitchen", "queue.call_next")).toBe(false);
    expect(roleHas("photographer", "queue.call_next")).toBe(false);
    expect(roleHas("nobody", "queue.read")).toBe(false);
  });
  it("admin has every key; required doc keys exist", () => {
    expect(STATIC_ROLE_PERMISSIONS.super_admin.length).toBe(PERMISSIONS.length);
    expect(STATIC_ROLE_PERMISSIONS.admin).not.toContain("roles.manage");
    for (const k of ["queue.checkin", "photos.review", "kitchen.read", "ledger.write"]) {
      expect((PERMISSIONS as readonly string[]).includes(k)).toBe(true);
    }
  });
});

describe("contracts", () => {
  it("TV feed schema has no room for private fields", () => {
    const keys = Object.keys(TvFeedSchema.shape).sort();
    expect(keys).toEqual(["announcementId", "instruction", "language", "nextToken", "token", "updatedAt"]);
  });
  it("QueueStatus parses the SQL shape", () => {
    const parsed = QueueStatusSchema.parse({
      eventId: "00000000-0000-4000-8000-0000000000a3",
      familyId: "00000000-0000-4000-8001-000000000001",
      checkedIn: true,
      token: 7,
      status: "waiting",
      position: 2,
      nowServing: 5,
      paused: false,
      updatedAt: "2026-12-13T13:30:00+00:00",
    });
    expect(parsed.position).toBe(2);
  });
});

describe("static permission map — lanes E2/E3", () => {
  it("kitchen sees no ledger; finance can read/export; only admin has ops.approve", () => {
    expect(roleHas("kitchen", "ledger.read")).toBe(false);
    expect(roleHas("finance", "ledger.read") && roleHas("finance", "ledger.export")).toBe(true);
    expect(ROLES_WITH("ops.approve").sort()).toEqual(["admin", "super_admin"]);
  });
  it("stage gets queue.skip only via the Flagsmith override, not the baseline", () => {
    expect(roleHas("stage_manager", "queue.skip")).toBe(false);
    expect(roleHas("admin", "queue.skip")).toBe(true);
  });
});

function ROLES_WITH(p: string) {
  return Object.entries(STATIC_ROLE_PERMISSIONS)
    .filter(([, ps]) => (ps as readonly string[]).includes(p))
    .map(([r]) => r);
}
