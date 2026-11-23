/**
 * Deterministic demo data: "Demo: Aarav and Meera", 3 events, 40 synthetic families.
 * Fixed ids so other lanes and tests can reference them.
 */
export const DEMO_WEDDING_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_EVENTS = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Haldi", startsAt: "2026-12-12T05:30:00Z", language: "hi", tvKey: "demo-tv-haldi-0001" },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "Sangeet", startsAt: "2026-12-12T13:30:00Z", language: "hi", tvKey: "demo-tv-sangeet-02" },
  { id: "00000000-0000-4000-8000-0000000000a3", name: "Reception", startsAt: "2026-12-13T13:30:00Z", language: "en", tvKey: "demo-tv-reception3" },
] as const;

export const DEMO_ROLES = ["host", "stage", "kitchen", "photographer", "admin", "finance"] as const;
export const demoEmail = (role: string) => `${role}@demo.pehleaap.test`;

const SURNAMES = ["Sharma", "Verma", "Iyer", "Reddy", "Kapoor", "Mehta", "Nair", "Gupta", "Joshi", "Bose", "Malhotra", "Chopra", "Patel", "Singh", "Rao", "Das", "Kulkarni", "Banerjee", "Menon", "Agarwal"];
const PREFIXES = ["", "Dr. ", ""];

/** Small seeded PRNG (mulberry32) so codes are stable across runs. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type DemoFamily = { id: string; name: string; phone: string; code: string; language: "en" | "hi"; linkKey: string; rsvpYes: boolean };

export function demoFamilies(n = 40): DemoFamily[] {
  const r = rng(20261212);
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const hex = k.toString(16).padStart(12, "0");
    return {
      id: `00000000-0000-4000-8001-${hex}`,
      name: `${PREFIXES[k % 3]}${SURNAMES[i % SURNAMES.length]} family${i >= SURNAMES.length ? " (2)" : ""}`,
      phone: `98765${String(k).padStart(5, "0")}`,
      code: String(Math.floor(r() * 9000) + 1000),
      language: k % 3 === 0 ? "hi" : "en",
      linkKey: `demo${String(k).padStart(4, "0")}${hex.slice(-8)}`,
      rsvpYes: k % 5 === 0, // a few already RSVP'd
    };
  });
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * One transaction. Re-running replaces the demo wedding: stage_log is append-only, so its
 * trigger is disabled only for this transaction to remove demo rows (table owner only).
 */
export function demoSql(users: { id: string; email: string; role: string }[] = []): string {
  const fams = demoFamilies();
  const eventIds = DEMO_EVENTS.map((e) => q(e.id)).join(",");
  const lines: string[] = [
    "begin;",
    "alter table stage_log disable trigger stage_log_no_update_delete;",
    `delete from photo_candidate where stage_log_id in (select id from stage_log where event_id in (${eventIds}));`,
    `delete from stage_log where event_id in (${eventIds});`,
    "alter table stage_log enable trigger stage_log_no_update_delete;",
    `delete from wedding where id = ${q(DEMO_WEDDING_ID)};`,
    `insert into wedding(id, name, is_demo) values (${q(DEMO_WEDDING_ID)}, 'Demo: Aarav and Meera', true);`,
    ...DEMO_EVENTS.map(
      (e) => `insert into event(id, wedding_id, name, starts_at, language, tv_key) values (${q(e.id)}, ${q(DEMO_WEDDING_ID)}, ${q(e.name)}, ${q(e.startsAt)}, ${q(e.language)}, ${q(e.tvKey)});`,
    ),
    ...fams.map(
      (f) => `insert into family(id, wedding_id, name, phone, language, link_key) values (${q(f.id)}, ${q(DEMO_WEDDING_ID)}, ${q(f.name)}, ${q(f.phone)}, ${q(f.language)}, ${q(f.linkKey)});`,
    ),
    `do $$ begin\n${fams.map((f) => `  perform set_checkin_code(${q(f.id)}, ${q(f.code)});`).join("\n")}\nend $$;`,
    ...fams.flatMap((f) =>
      DEMO_EVENTS.map((e) => `insert into rsvp(family_id, event_id, status, headcount) values (${q(f.id)}, ${q(e.id)}, ${f.rsvpYes ? "'yes', 4" : "'pending', 0"});`),
    ),
    ...users.flatMap((u) => [
      `insert into app_user(id, email, display_name) values (${q(u.id)}, ${q(u.email)}, ${q(`Demo ${u.role}`)}) on conflict (id) do update set email = excluded.email;`,
      `insert into user_role(user_id, role_id, wedding_id) select ${q(u.id)}, id, ${q(DEMO_WEDDING_ID)} from role where key = ${q(u.role)} on conflict do nothing;`,
    ]),
    "commit;",
  ];
  return lines.join("\n");
}
