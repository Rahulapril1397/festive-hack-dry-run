import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/authz/staticMap";
import { DEMO_SCOPE, inScope, scopedTools, staffActive } from "@/lib/assistant/scope";
import { groupFor } from "@/domain/rsvp/group";
import { languageSplitPct } from "@/lib/flags/split";
import { createFlagClient } from "@/lib/flags/client";
import { GROUP_LANGUAGES, ENABLED_LANGUAGES, languagesFor, isTvLanguage } from "@/lib/sarvam/languages";
import { fromAcceptLanguage } from "@/lib/geo/acceptLanguage";
import { replyLanguage } from "@/lib/assistant/voice";
import { TILES, audiencesFor, readinessPercent } from "@/lib/demo/staticTiles";
import { navFor } from "@/components/shell/navConfig";

const perms = (r: keyof typeof DEFAULT_ROLE_PERMISSIONS) => new Set<string>(DEFAULT_ROLE_PERMISSIONS[r]);

describe("PinkyBua demo scope", () => {
  it("admin gets only the photo counts tool; a guest only their own RSVP", () => {
    expect(scopedTools("staff", perms("admin")).map((t) => t.name)).toEqual(["photo_review_counts"]);
    expect(scopedTools("staff", perms("super_admin")).map((t) => t.name)).toEqual(["photo_review_counts"]);
    expect(scopedTools("guest", new Set()).map((t) => t.name)).toEqual(["my_rsvp"]);
  });
  it("permissions still apply inside the scope (a role without photos.review gets nothing)", () => {
    expect(scopedTools("staff", perms("kitchen"))).toEqual([]);
    expect(scopedTools("staff", perms("stage_manager"))).toEqual([]);
  });
  it("everything else is out of scope, including write tools and ledger amounts", () => {
    for (const t of ["ledger_summary", "queue_status", "rsvp_summary", "set_my_language", "vendor_lookup", "my_queue", "my_gifts", "faq"]) {
      expect(inScope("staff", t) || inScope("guest", t), t).toBe(false);
    }
    expect(DEMO_SCOPE.staff).toHaveLength(1);
    expect(DEMO_SCOPE.guest).toHaveLength(1);
  });
  it("active for admin and super admin only", () => {
    expect(staffActive({ isSuperAdmin: false, roles: ["admin"] })).toBe(true);
    expect(staffActive({ isSuperAdmin: true, roles: [] })).toBe(true);
    for (const r of ["host", "coordinator", "stage_manager", "finance", "kitchen", "photographer", "vendor", "helper"]) expect(staffActive({ isSuperAdmin: false, roles: [r] }), r).toBe(false);
  });
});

describe("guest language A/B groups", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  it("placement is stable per family and follows the split", () => {
    expect(groupFor(ids[3]!, 50)).toBe(groupFor(ids[3]!, 50));
    const b = ids.filter((id) => groupFor(id, 50) === "B").length;
    expect(b).toBeGreaterThan(440);
    expect(b).toBeLessThan(560);
    expect(ids.every((id) => groupFor(id, 0) === "A")).toBe(true);
    expect(ids.every((id) => groupFor(id, 100) === "B")).toBe(true);
    expect(groupFor(ids[0]!, Number.NaN)).toMatch(/^[AB]$/);
  });
  it("raising the split only ever moves families from A to B", () => {
    for (const id of ids.slice(0, 200)) if (groupFor(id, 30) === "B") expect(groupFor(id, 60)).toBe("B");
  });
  it("group A: English and Hindi; group B: all ten; unknown group behaves as A", () => {
    expect(GROUP_LANGUAGES.A).toEqual(["en", "hi"]);
    expect(GROUP_LANGUAGES.B).toEqual(ENABLED_LANGUAGES);
    expect(languagesFor(null)).toEqual(["en", "hi"]);
    expect(languagesFor("B")).toHaveLength(10);
  });
  it("the venue TV stays English and Hindi", () => {
    expect(isTvLanguage("hi")).toBe(true);
    expect(isTvLanguage("ta")).toBe(false);
  });
  it("browser language suggestion respects the group's list", () => {
    expect(fromAcceptLanguage("ta-IN,ta;q=0.9,en;q=0.5")).toBe("ta");
    expect(fromAcceptLanguage("ta-IN,ta;q=0.9,en;q=0.5", GROUP_LANGUAGES.A)).toBe("en");
    expect(fromAcceptLanguage("fr-FR", GROUP_LANGUAGES.A)).toBeNull();
  });
});

describe("Flagsmith split percentage (no guest id ever sent)", () => {
  const client = (flags: unknown, fail = false) => createFlagClient({ serverKey: "k", fetchImpl: (async () => (fail ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(flags), { status: 200 }))) as unknown as typeof fetch });
  it("reads the flag value, closes group B when the flag is OFF, defaults to 50", async () => {
    expect(await languageSplitPct(client([{ feature: { name: "pinkybua_languages" }, enabled: true, feature_state_value: "30" }]))).toBe(30);
    expect(await languageSplitPct(client([{ feature: { name: "pinkybua_languages" }, enabled: false, feature_state_value: "30" }]))).toBe(0);
    expect(await languageSplitPct(client([{ feature: { name: "pinkybua_languages" }, enabled: true, feature_state_value: "oops" }]))).toBe(50);
    expect(await languageSplitPct(client([{ feature: { name: "pinkybua_languages" }, enabled: true, feature_state_value: 250 }]))).toBe(100);
    expect(await languageSplitPct(client([]))).toBe(50);
    expect(await languageSplitPct(client({}, true))).toBe(50);
  });
});

describe("spoken reply language by script", () => {
  it("picks the language of the script the reply is written in", () => {
    expect(replyLanguage("अभी टोकन 12 स्टेज पर है।", "en")).toBe("hi");
    expect(replyLanguage("எந்த செயல்பாடுகளுக்கு நாங்கள் ஒப்புதல் அளித்துள்ளோம்?", "ta")).toBe("ta");
    expect(replyLanguage("ఏ విధులు మేము అంగీకరించాము?", "en")).toBe("te");
    expect(replyLanguage("কোন কার্যকারিতাগুলিতে আমরা সম্মতি জানিয়েছি?", "en")).toBe("bn");
    expect(replyLanguage("કયા કાર્યો માટે અમે સંમતિ આપી છે?", "en")).toBe("gu");
    expect(replyLanguage("ਕਿਹੜੇ ਕਾਰਜ ਲਈ ਅਸੀਂ ਸਹਿਮਤੀ ਦਿੱਤੀ ਹੈ?", "en")).toBe("pa");
    expect(replyLanguage("आपण कोणत्या कार्यांना होकार दिला आहे?", "mr")).toBe("mr");
    expect(replyLanguage("Token 12 is on stage.", "hi")).toBe("en");
    expect(replyLanguage("12", "ta")).toBe("ta");
  });
});

describe("static demo tiles", () => {
  it("four tiles with fixed data and an Add button label; invented data only", () => {
    expect(Object.keys(TILES).sort()).toEqual(["ledger", "readiness", "tasks", "vendors"]);
    for (const t of Object.values(TILES)) {
      expect(t.add).toMatch(/^Add /);
      expect(t.permissions.length).toBeGreaterThan(0);
    }
    expect(TILES.vendors.kind === "table" && TILES.vendors.rows).toHaveLength(6);
    expect(TILES.tasks.kind === "table" && TILES.tasks.rows).toHaveLength(8);
    expect(TILES.ledger.kind === "table" && TILES.ledger.rows).toHaveLength(8);
    expect(TILES.readiness.kind === "checklists" && TILES.readiness.groups.map((g) => g.name)).toEqual(["Haldi", "Sangeet", "Reception"]);
  });
  it("tasks: admins see all; a vendor or helper sees only their own; other roles the team's", () => {
    expect(audiencesFor(["admin"], false)).toEqual(["team", "vendor", "helper"]);
    expect(audiencesFor([], true)).toHaveLength(3);
    expect(audiencesFor(["vendor"], false)).toEqual(["vendor"]);
    expect(audiencesFor(["helper"], false)).toEqual(["helper"]);
    expect(audiencesFor(["kitchen"], false)).toEqual(["team"]);
    const t = TILES.tasks;
    if (t.kind !== "table") throw new Error("table");
    expect(t.rows.filter((r) => r.audience === "vendor")).toHaveLength(2);
    expect(t.rows.filter((r) => r.audience === "helper")).toHaveLength(3);
  });
  it("readiness percent counts done items", () => {
    expect(readinessPercent([{ status: "done" }, { status: "done" }, { status: "in_progress" }, { status: "not_started" }])).toBe(50);
  });
  it("every tile is reachable by at least one default role, and a role sees a tile only through its permission", () => {
    for (const [key, tile] of Object.entries(TILES)) {
      const seen = (Object.keys(DEFAULT_ROLE_PERMISSIONS) as (keyof typeof DEFAULT_ROLE_PERMISSIONS)[]).filter((r) => tile.permissions.some((p) => perms(r).has(p)));
      expect(seen.length, key).toBeGreaterThan(0);
      for (const r of seen) expect(navFor(perms(r)).some((n) => n.key === key), `${r} sees ${key}`).toBe(true);
    }
  });
});
