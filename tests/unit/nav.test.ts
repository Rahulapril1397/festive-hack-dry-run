import { describe, expect, it } from "vitest";
import { NAV, navFor, homeFor } from "@/components/shell/navConfig";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/authz/staticMap";
import { SYSTEM_ROLES } from "@/lib/authz/catalogue";

const perms = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => new Set<string>(DEFAULT_ROLE_PERMISSIONS[role]);
const keys = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => navFor(perms(role)).map((i) => i.key);

describe("role-to-nav map (from the permission set)", () => {
  it("host wireframe entries exist", () => {
    expect(NAV.map((n) => n.label)).toEqual(
      expect.arrayContaining(["Overview", "Functions", "Families and RSVP", "Kitchen", "Stage and Queue", "Album", "Gift ledger", "Event readiness", "Vendors", "Tasks", "Users and Roles"]),
    );
  });
  it("kitchen: kitchen + readiness + own tasks — no ledger, stage or families", () => {
    expect(keys("kitchen")).toEqual(["kitchen", "readiness", "tasks"]);
  });
  it("demo menu: static tiles by permission, hidden features gone", () => {
    expect(NAV.filter((n) => n.soon)).toEqual([]);
    for (const hidden of ["gifts", "thank-yous", "people", "jobs"]) expect(NAV.some((n) => n.key === hidden)).toBe(false);
    expect(keys("host")).toEqual(expect.arrayContaining(["vendors", "readiness", "tasks", "ledger", "review", "album"]));
    expect(keys("coordinator")).toEqual(expect.arrayContaining(["vendors", "readiness", "tasks", "families"]));
    expect(keys("coordinator")).not.toContain("ledger");
    expect(keys("finance")).toEqual(expect.arrayContaining(["vendors", "readiness", "tasks", "ledger"]));
    expect(keys("finance")).not.toContain("families");
    expect(keys("stage_manager")).toEqual(["stage", "readiness", "tasks"]);
    expect(keys("photographer")).toEqual(["photographer", "review", "album", "readiness", "tasks"]);
  });
  it("a custom vendor role (vendors.contacts.read + tasks.read) sees Vendors, Event readiness and Tasks; a helper sees the last two", () => {
    expect(navFor(new Set(["vendors.contacts.read", "tasks.read"])).map((i) => i.key)).toEqual(["vendors", "readiness", "tasks"]);
    expect(navFor(new Set(["tasks.read", "tasks.update_own"])).map((i) => i.key)).toEqual(["readiness", "tasks"]);
  });
  it("Users and Roles only with users.manage", () => {
    for (const r of SYSTEM_ROLES) expect(keys(r).includes("users")).toBe(DEFAULT_ROLE_PERMISSIONS[r].includes("users.manage"));
  });
  it("super admin sees everything", () => {
    expect(keys("super_admin")).toHaveLength(NAV.length);
  });
  it("every system role lands on a screen it may open", () => {
    for (const r of SYSTEM_ROLES) {
      const home = homeFor(r, perms(r));
      expect(navFor(perms(r)).some((i) => i.href === home), `${r} → ${home}`).toBe(true);
    }
  });
  it("custom role lands on its first nav item; no permissions → no-access", () => {
    expect(homeFor("decorator", new Set(["tasks.read"]))).toBe("/demo/readiness");
    expect(homeFor("nobody", new Set())).toBe("/no-access");
  });
});
