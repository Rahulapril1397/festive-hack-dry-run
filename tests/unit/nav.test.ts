import { describe, expect, it } from "vitest";
import { NAV, navFor, homeFor } from "@/components/shell/navConfig";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/authz/staticMap";
import { SYSTEM_ROLES } from "@/lib/authz/catalogue";

const perms = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => new Set<string>(DEFAULT_ROLE_PERMISSIONS[role]);
const keys = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => navFor(perms(role)).map((i) => i.key);

describe("role-to-nav map (from the permission set)", () => {
  it("host wireframe entries exist", () => {
    expect(NAV.map((n) => n.label)).toEqual(
      expect.arrayContaining(["Overview", "Functions", "Families and RSVP", "Kitchen", "Stage and Queue", "Album", "Shagun Ledger", "Thank-yous", "Vendors", "Tasks", "Users and Roles"]),
    );
  });
  it("kitchen: kitchen + own tasks — no ledger, stage or families", () => {
    expect(keys("kitchen")).toEqual(["kitchen", "tasks"]);
  });
  it("Stage 3 entries are live (no 'soon' items left in the nav)", () => {
    expect(NAV.filter((n) => n.soon)).toEqual([]);
    expect(keys("host")).toEqual(expect.arrayContaining(["tasks", "vendors", "gifts", "thank-yous"]));
    expect(keys("coordinator")).not.toContain("thank-yous");
    expect(keys("finance")).toContain("vendors");
    expect(keys("stage_manager")).not.toContain("vendors");
  });
  it("finance sees the ledger; stage manager does not", () => {
    expect(keys("finance")).toContain("ledger");
    expect(keys("stage_manager")).not.toContain("ledger");
    expect(keys("stage_manager")).toContain("stage");
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
    expect(homeFor("decorator", new Set(["kitchen.read"]))).toBe("/kitchen");
    expect(homeFor("nobody", new Set())).toBe("/no-access");
  });
});
