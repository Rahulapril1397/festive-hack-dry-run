import { describe, expect, it } from "vitest";
import { NAV, navFor, homeFor } from "@/components/shell/navConfig";
import { ROLES } from "@/lib/authz/staticMap";

const keys = (role: string) => navFor(role).map((i) => i.key);

describe("role-to-nav map", () => {
  it("host wireframe entries exist in order", () => {
    expect(NAV.map((n) => n.label)).toEqual(
      expect.arrayContaining(["Overview", "Functions", "Families and RSVP", "Kitchen", "Stage and Queue", "Album", "Shagun Ledger", "Thank-yous", "Vendors", "Tasks", "Users and Roles"]),
    );
  });
  it("kitchen: no ledger, no stage, no families", () => {
    expect(keys("kitchen")).toEqual(["kitchen"]);
  });
  it("finance sees the ledger; photographer sees upload + review", () => {
    expect(keys("finance")).toContain("ledger");
    expect(keys("photographer")).toEqual(expect.arrayContaining(["photographer", "review"]));
    expect(keys("photographer")).not.toContain("ledger");
  });
  it("admin sees everything", () => {
    expect(keys("admin")).toHaveLength(NAV.length);
  });
  it("every role has a reachable home it is allowed to see", () => {
    for (const r of ROLES) {
      const home = homeFor(r);
      expect(navFor(r).some((i) => i.href === home)).toBe(true);
    }
  });
  it("unknown role gets nothing", () => {
    expect(navFor("guest")).toEqual([]);
  });
});
