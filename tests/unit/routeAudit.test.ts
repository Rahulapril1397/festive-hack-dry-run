import { describe, expect, it } from "vitest";
import { auditRoutes } from "../../scripts/route-audit";

const { rows, guardProblems } = auditRoutes();
const find = (route: string, method: string) => rows.find((r) => r.route === route && r.method === method)!;

describe("route audit (E1 T2)", () => {
  it("every handler checks a permission or is an explicit publicRoute; every guard helper reaches requirePermission", () => {
    expect(rows.filter((r) => !r.ok).map((r) => `${r.method} ${r.route}`)).toEqual([]);
    expect(guardProblems).toEqual([]);
  });

  it("public routes are exactly the ones with a non-permission safeguard", () => {
    const pub = rows.filter((r) => r.guards.length === 1 && r.guards[0] === "publicRoute").map((r) => `${r.method} ${r.route}`).sort();
    expect(pub).toEqual([
      "GET /api/guest/gifts", "GET /api/guest/status", "GET /api/health", "GET /api/metrics", "GET /api/notifications", "GET /api/tv/announcement/[id]/audio", "GET /api/tv/feed", "GET /api/tv/stream",
      "POST /api/auth/logout", "POST /api/checkin/verify", "POST /api/guest/gifts/[id]/claim", "POST /api/guest/gifts/claims/[id]/release",
      "POST /api/guest/language", "POST /api/guest/language/suggest", "POST /api/integrations/nudgebee/recommendation",
      "POST /api/jobs/tick", "POST /api/notifications/read", "POST /api/session/wedding", "POST /api/tv/telemetry", "PUT /api/guest/rsvp",
    ]);
  });

  it("sensitive routes name the right permission", () => {
    expect(find("/api/ops/recommendations/[id]/approve", "POST").permissions).toEqual(["ops.approve"]);
    expect(find("/api/queue/[event]/call-next", "POST").permissions).toEqual(["queue.call_next"]);
    expect(find("/api/admin/roles", "POST").permissions).toEqual(["roles.manage"]);
    expect(find("/api/admin/weddings", "POST").permissions).toEqual(["weddings.manage"]);
    expect(find("/api/admin/families/import", "POST").permissions).toEqual(["families.write"]);
    expect(find("/api/host/families/[id]/rsvp", "PUT").permissions).toEqual(["rsvp.manage"]);
    for (const r of rows.filter((x) => x.route.startsWith("/api/admin/"))) expect(r.guards, r.route).toContain("requireAdmin");
    for (const r of rows.filter((x) => x.route.startsWith("/api/ledger"))) expect(r.guards, r.route).toContain("ledgerAccess");
  });
});
