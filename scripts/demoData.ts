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

/** Role keys of the seeded staff users (Stage 2 names). super_admin is wedding-less. */
export const DEMO_ROLES = ["host", "stage_manager", "kitchen", "photographer", "admin", "finance", "coordinator", "super_admin"] as const;
/** Email local part per role; stage_manager keeps the Stage 1 address so existing logins still work. */
const EMAIL_LOCAL: Record<string, string> = { stage_manager: "stage", super_admin: "superadmin" };
export const demoEmail = (role: string) => `${EMAIL_LOCAL[role] ?? role}@demo.pehleaap.test`;

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
    // append-only tables: triggers off for this transaction only, to remove demo rows
    "alter table stage_log disable trigger stage_log_no_update_delete;",
    "alter table ledger_entry disable trigger ledger_entry_append_only;",
    "alter table ledger_reconciliation disable trigger ledger_reconciliation_append_only;",
    `delete from batch where event_id in (${eventIds});`,
    `delete from ledger_reconciliation where entry_id in (select id from ledger_entry where wedding_id = ${q(DEMO_WEDDING_ID)});`,
    `delete from ledger_entry where wedding_id = ${q(DEMO_WEDDING_ID)} and reverses_id is not null;`,
    `delete from ledger_entry where wedding_id = ${q(DEMO_WEDDING_ID)};`,
    `delete from stage_log where event_id in (${eventIds});`,
    "alter table stage_log enable trigger stage_log_no_update_delete;",
    "alter table ledger_entry enable trigger ledger_entry_append_only;",
    "alter table ledger_reconciliation enable trigger ledger_reconciliation_append_only;",
    `delete from wedding where id = ${q(DEMO_WEDDING_ID)};`,
    `insert into wedding(id, name, is_demo, couple_names, wedding_date, contact_phone, invitation_text) values (${q(DEMO_WEDDING_ID)}, 'Demo: Aarav and Meera', true, 'Aarav & Meera', '2026-12-13', '+91 98000 00000', 'With joy in our hearts, we invite your family to celebrate our wedding.');`,
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
    // a few shagun entries so the finance screen has data (no family link on one = unmatched envelope)
    `insert into ledger_entry(wedding_id, family_id, event_id, token_reference, payment_method, amount, notes) values (${q(DEMO_WEDDING_ID)}, ${q(fams[4]!.id)}, ${q(DEMO_EVENTS[2].id)}, 'T-5', 'cash', 5100, 'Demo envelope');`,
    `insert into ledger_entry(wedding_id, family_id, event_id, token_reference, payment_method, amount, notes) values (${q(DEMO_WEDDING_ID)}, ${q(fams[9]!.id)}, ${q(DEMO_EVENTS[2].id)}, 'T-10', 'upi', 11000, 'Demo UPI');`,
    `insert into ledger_entry(wedding_id, event_id, token_reference, payment_method, amount, notes) values (${q(DEMO_WEDDING_ID)}, ${q(DEMO_EVENTS[2].id)}, 'unlabelled', 'cash', 2100, 'Envelope without name');`,
    `insert into ledger_entry(wedding_id, family_id, event_id, payment_method, gift_type, notes) values (${q(DEMO_WEDDING_ID)}, ${q(fams[14]!.id)}, ${q(DEMO_EVENTS[2].id)}, 'boxed_gift', 'dinner set', 'Boxed gift');`,
    ...users.flatMap((u) => [
      `insert into app_user(id, email, display_name) values (${q(u.id)}, ${q(u.email)}, ${q(`Demo ${u.role}`)}) on conflict (id) do update set email = excluded.email;`,
      `update app_user set status = 'active' where id = ${q(u.id)};`,
      u.role === "super_admin"
        ? `insert into user_role(user_id, role_id, wedding_id) select ${q(u.id)}, id, null from role where key = 'super_admin' on conflict do nothing;`
        : `insert into user_role(user_id, role_id, wedding_id) select ${q(u.id)}, id, ${q(DEMO_WEDDING_ID)} from role where key = ${q(u.role)} and wedding_id is null on conflict do nothing;`,
    ]),
    ...stage3Sql(fams),
    "commit;",
  ];
  return lines.join("\n");
}

/** Stage 3 demo rows: a helper without a login, tasks (one overdue), vendors booked per function, a wishlist. */
function stage3Sql(fams: DemoFamily[]): string[] {
  const W = q(DEMO_WEDDING_ID);
  const [mehendi, sangeet, wedding] = DEMO_EVENTS;
  const cat = (k: string) => `(select id from vendor_category where wedding_id = ${W} and key = '${k}')`;
  const owner = (email: string) => `(select p.id from participant p join app_user u on u.id = p.user_id where p.wedding_id = ${W} and u.email = ${q(email)})`;
  const vendors = [
    { id: "00000000-0000-4000-8000-0000000000f1", cat: "caterer", name: "Sharma Caterers", contact: "Raju Sharma", phone: "9811100001", event: wedding.id, scope: "Dinner for 300 (veg)" },
    { id: "00000000-0000-4000-8000-0000000000f2", cat: "decorator", name: "Phoolwala Decor", contact: "Anita", phone: "9811100002", event: sangeet.id, scope: "Stage + entrance" },
    { id: "00000000-0000-4000-8000-0000000000f3", cat: "mehendi", name: "Henna by Sana", contact: "Sana", phone: "9811100003", event: mehendi.id, scope: "Bride + 20 guests" },
    { id: "00000000-0000-4000-8000-0000000000f4", cat: "dhol_band", name: "Punjab Dhol Group", contact: "Gurpreet", phone: "9811100004", event: wedding.id, scope: "Baraat, 2 hours" },
  ];
  return [
    `insert into participant(wedding_id, display_name, phone, title) values (${W}, 'Mama ji', '9811100099', 'Stage helper (no login yet)');`,
    ...vendors.flatMap((v) => [
      `insert into vendor(id, wedding_id, category_id, name, city) values (${q(v.id)}, ${W}, ${cat(v.cat)}, ${q(v.name)}, 'Delhi');`,
      `insert into vendor_contact(vendor_id, name, phone, is_primary) values (${q(v.id)}, ${q(v.contact)}, ${q(v.phone)}, true);`,
      `insert into vendor_event_assignment(vendor_id, event_id, scope) values (${q(v.id)}, ${q(v.event)}, ${q(v.scope)});`,
    ]),
    `insert into vendor_commercial(vendor_id, contract_amount_paise, contract_status, payment_terms) values (${q(vendors[0]!.id)}, 45000000, 'signed', '30% advance, rest on the day');`,
    `insert into vendor_payment(vendor_id, kind, amount_paise, paid_at, method) values (${q(vendors[0]!.id)}, 'advance', 13500000, '2026-11-20', 'bank');`,
    `select task_create(null, ${W}, jsonb_build_object('title', 'Confirm final headcount with caterer', 'ownerParticipantId', ${owner(demoEmail("host"))}, 'vendorId', ${q(vendors[0]!.id)}, 'eventId', ${q(wedding.id)}, 'dueAt', (now() - interval '3 hours')::text, 'priority', 'high'));`,
    `select task_create(null, ${W}, jsonb_build_object('title', 'Test the TV screen and speakers', 'ownerParticipantId', ${owner(demoEmail("stage_manager"))}, 'eventId', ${q(sangeet.id)}, 'dueAt', (now() + interval '20 hours')::text));`,
    `select task_create(null, ${W}, jsonb_build_object('title', 'Print token slips', 'ownerParticipantId', (select id from participant where wedding_id = ${W} and display_name = 'Mama ji'), 'dueAt', (now() + interval '2 days')::text, 'priority', 'low'));`,
    `select gift_upsert(null, ${W}, null, '{"title":"Dinner set (12 pieces)","priceBand":"5k_10k","quantity":2}');`,
    `select gift_upsert(null, ${W}, null, '{"title":"Pressure cooker","priceBand":"2k_5k","quantity":1}');`,
    `select gift_upsert(null, ${W}, null, '{"title":"Bedsheet set","priceBand":"under_2k","quantity":3}');`,
    `select gift_claim_create(${q(fams[1]!.id)}, (select id from gift where wedding_id = ${W} and title like 'Dinner set%'), 1);`,
  ];
}
