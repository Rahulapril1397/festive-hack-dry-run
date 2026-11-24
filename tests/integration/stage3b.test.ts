import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createFixture, dropFixture } from "../../scripts/fixture";

const url = process.env.DATABASE_URL;

/** Stage 3 E2 (gifts, thank-yous) and E3 (vendors) at the SQL level. */
describe.skipIf(!url)("stage 3 — E2 + E3 (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 25, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let families: string[] = [];

  beforeAll(async () => {
    fx = await createFixture(sql, 22);
    families = (await sql`select id from family where wedding_id = ${fx.weddingId} order by phone`).map((r) => r.id as string);
  });
  afterAll(async () => {
    if (fx) await dropFixture(sql, fx.weddingId);
    await sql.end();
  });

  // ─── gifts ─────────────────────────────────────────────────────────────────────────────────
  it("20 families claim a gift with quantity 3 at once → exactly 3 claims", async () => {
    const [g] = await sql<{ id: string }[]>`select id from gift_upsert(null, ${fx.weddingId}, null, ${sql.json({ title: "Dinner set", quantity: 3 })})`;
    const results = await Promise.allSettled(families.slice(0, 20).map((f) => sql`select id from gift_claim_create(${f}, ${g!.id}, 1)`));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length).toBe(17);
    expect(rejected.every((r) => /GIFT_UNAVAILABLE/.test(String(r.reason)))).toBe(true);
    const [{ n }] = (await sql`select gift_claimed_qty(${g!.id}) n`) as unknown as [{ n: number }];
    expect(n).toBe(3);
  });

  it("claims are idempotent per family, releasable, and fulfilment blocks release", async () => {
    const [g] = await sql<{ id: string }[]>`select id from gift_upsert(null, ${fx.weddingId}, null, ${sql.json({ title: "Tea set", quantity: 1 })})`;
    const f = families[20]!;
    const [a] = await sql<{ id: string }[]>`select id from gift_claim_create(${f}, ${g!.id}, 1)`;
    const [b] = await sql<{ id: string }[]>`select id from gift_claim_create(${f}, ${g!.id}, 1)`;
    expect(b!.id).toBe(a!.id);
    await expect(sql`select gift_claim_create(${families[21]!}, ${g!.id}, 1)`).rejects.toThrow(/GIFT_UNAVAILABLE/);
    await expect(sql`select gift_upsert(null, ${fx.weddingId}, ${g!.id}, ${sql.json({ quantity: 0 })})`).rejects.toThrow();
    await sql`select gift_claim_fulfil(null, ${fx.weddingId}, ${a!.id}, true)`;
    await expect(sql`select gift_claim_release(${f}, ${a!.id})`).rejects.toThrow(/INVALID_TRANSITION/);
    await sql`select gift_claim_fulfil(null, ${fx.weddingId}, ${a!.id}, false)`;
    await sql`select gift_claim_release(${f}, ${a!.id})`;
    await sql`select gift_claim_create(${families[21]!}, ${g!.id}, 1)`; // freed up
  });

  it("a family cannot claim another wedding's gift or release another family's claim", async () => {
    const other = await createFixture(sql, 1);
    try {
      const [g] = await sql<{ id: string }[]>`select id from gift_upsert(null, ${other.weddingId}, null, ${sql.json({ title: "Lamp" })})`;
      await expect(sql`select gift_claim_create(${families[0]!}, ${g!.id}, 1)`).rejects.toThrow(/NOT_FOUND/);
      const [mine] = await sql<{ id: string }[]>`select c.id from gift_claim c join gift g on g.id = c.gift_id where g.wedding_id = ${fx.weddingId} and c.status = 'claimed' limit 1`;
      await expect(sql`select gift_claim_release(${families[19]!}, ${mine!.id})`).rejects.toThrow(/NOT_FOUND/);
    } finally {
      await dropFixture(sql, other.weddingId);
    }
  });

  // ─── thank-yous ────────────────────────────────────────────────────────────────────────────
  it("draft → send → first open counted once; sent notes are never rewritten", async () => {
    const f = families[5]!;
    const [n] = await sql<{ id: string }[]>`select id from thanks_save_draft(null, ${fx.weddingId}, ${f}, ${sql.json({ variant: "A", language: "en", body: "Thank you!", bodyEn: "Thank you!", translated: true })})`;
    const none = await sql`select (thanks_open(${f})).id`;
    expect(none[0]!.id).toBeNull(); // drafts are invisible to the family
    const [{ s }] = (await sql`select thanks_send(null, ${fx.weddingId}, ${[n!.id]}) s`) as unknown as [{ s: number }];
    expect(s).toBe(1);
    const [{ k }] = (await sql`select count(*)::int k from notification where family_id = ${f} and kind = 'thank_you'`) as unknown as [{ k: number }];
    expect(k).toBe(1);
    for (let i = 0; i < 3; i++) await sql`select thanks_open(${f})`;
    const [row] = await sql`select open_count, opened_at from thank_note where id = ${n!.id}`;
    expect(row!.open_count).toBe(3);
    const [r] = await sql`select sent, opened from v_thanks_results where wedding_id = ${fx.weddingId} and variant = 'A'`;
    expect(r).toEqual({ sent: 1, opened: 1 });
    await expect(sql`select thanks_save_draft(null, ${fx.weddingId}, ${f}, ${sql.json({ variant: "A", language: "en", body: "x", bodyEn: "x" })})`).rejects.toThrow(/INVALID_TRANSITION/);
  });

  it("thank-you attachments must belong to that family", async () => {
    const [c] = await sql<{ id: string }[]>`select c.id from gift_claim c join gift g on g.id = c.gift_id where g.wedding_id = ${fx.weddingId} and c.family_id = ${families[0]!} and c.status <> 'released' limit 1`;
    await expect(sql`select thanks_save_draft(null, ${fx.weddingId}, ${families[7]!}, ${sql.json({ variant: "B", language: "en", body: "x", bodyEn: "x", giftClaimId: c!.id })})`).rejects.toThrow(/BAD_REQUEST/);
    await sql`select thanks_save_draft(null, ${fx.weddingId}, ${families[0]!}, ${sql.json({ variant: "B", language: "en", body: "x", bodyEn: "x", giftClaimId: c!.id })})`;
  });

  // ─── vendors ───────────────────────────────────────────────────────────────────────────────
  const cat = async (key: string) => ((await sql`select id from vendor_category where wedding_id = ${fx.weddingId} and key = ${key}`)[0] as { id: string }).id;

  it("new weddings get vendor categories; vendor + contacts in one call; duplicate guard", async () => {
    const [{ n }] = (await sql`select count(*)::int n from vendor_category where wedding_id = ${fx.weddingId}`) as unknown as [{ n: number }];
    expect(n).toBe(14);
    const [v] = await sql<{ id: string }[]>`select id from vendor_upsert(null, ${fx.weddingId}, null, ${sql.json({ categoryId: await cat("caterer"), name: "Sharma Caterers", contacts: [{ name: "Raju", phone: "9876543210", isPrimary: true }] })})`;
    expect((await sql`select count(*)::int n from vendor_contact where vendor_id = ${v!.id}`)[0]!.n).toBe(1);
    await expect(sql`select vendor_upsert(null, ${fx.weddingId}, null, ${sql.json({ categoryId: await cat("caterer"), name: "sharma caterers " })})`).rejects.toThrow(/VENDOR_DUPLICATE/);
    const dupes = await sql`select name, reason from vendor_duplicates(${fx.weddingId}, 'Sharma Caterer', '+91 98765 43210', null)`;
    expect(dupes.map((d) => d.reason).sort()).toEqual(["same phone", "similar name"]);
    // "Add anyway" after the warning (force) is allowed
    const [again] = await sql<{ id: string }[]>`select id from vendor_upsert(null, ${fx.weddingId}, null, ${sql.json({ categoryId: await cat("caterer"), name: "Sharma Caterers", force: true })})`;
    expect(again!.id).not.toBe(v!.id);
  });

  it("commercial changes are audited as a diff without amounts", async () => {
    const [v] = await sql<{ id: string }[]>`select id from vendor_upsert(null, ${fx.weddingId}, null, ${sql.json({ categoryId: await cat("decorator"), name: "Phool Decor" })})`;
    await sql`select vendor_set_commercial(null, ${fx.weddingId}, ${v!.id}, ${sql.json({ contractAmountPaise: "25000000", contractStatus: "signed" })})`;
    await sql`select vendor_add_payment(null, ${fx.weddingId}, ${v!.id}, ${sql.json({ kind: "advance", amountPaise: 5000000, paidAt: "2026-12-01" })})`;
    const rows = await sql`select action, data from audit_log where target = ${v!.id} and action in ('vendor.commercial','vendor.payment') order by id`;
    expect(rows[0]!.data).toEqual({ contract_amount: { changed: true }, contract_status: { from: "none", to: "signed" } });
    expect(JSON.stringify(rows.map((r) => r.data))).not.toMatch(/25000000|5000000|250000|50000/);
  });

  it("vendor bookings and documents stay inside the wedding", async () => {
    const [v] = await sql<{ id: string }[]>`select id from vendor where wedding_id = ${fx.weddingId} limit 1`;
    await sql`select vendor_assign_event(null, ${fx.weddingId}, ${v!.id}, ${fx.eventId}, 'Dinner for 300', null, false)`;
    await sql`select vendor_assign_event(null, ${fx.weddingId}, ${v!.id}, ${fx.eventId}, 'Dinner for 350', null, false)`;
    expect((await sql`select scope from vendor_event_assignment where vendor_id = ${v!.id}`).map((r) => r.scope)).toEqual(["Dinner for 350"]);
    const other = await createFixture(sql, 0);
    try {
      await expect(sql`select vendor_assign_event(null, ${fx.weddingId}, ${v!.id}, ${other.eventId}, null, null, false)`).rejects.toThrow(/EVENT_NOT_FOUND/);
      await expect(sql`select vendor_set_status(null, ${other.weddingId}, ${v!.id}, 'inactive')`).rejects.toThrow(/INVALID_TRANSITION/);
    } finally {
      await dropFixture(sql, other.weddingId);
    }
    const bad = { kind: "contract", fileName: "c.pdf", storagePath: `${randomUUID()}/${v!.id}/x.pdf`, contentType: "application/pdf", sizeBytes: 10 };
    await expect(sql`select vendor_add_document(null, ${fx.weddingId}, ${v!.id}, ${sql.json(bad)})`).rejects.toThrow(/BAD_REQUEST/);
    const [d] = await sql<{ id: string }[]>`select id from vendor_add_document(null, ${fx.weddingId}, ${v!.id}, ${sql.json({ ...bad, storagePath: `${fx.weddingId}/${v!.id}/x.pdf` })})`;
    await sql`select vendor_delete_document(null, ${fx.weddingId}, ${d!.id})`;
  });

  it("vendor permission matrix (role defaults from 0210)", async () => {
    const rows = await sql`select r.key, array_agg(rp.permission_key order by rp.permission_key) p from role r join role_permission rp on rp.role_id = r.id
                            where r.wedding_id is null and rp.permission_key like 'vendors.%' group by r.key`;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.p]));
    const ALL = ["vendors.commercial.read", "vendors.commercial.write", "vendors.contacts.read", "vendors.documents.read", "vendors.manage"];
    expect(m.host).toEqual(ALL);
    expect(m.admin).toEqual(ALL);
    expect(m.coordinator).toEqual(["vendors.contacts.read"]);
    expect(m.finance).toEqual(["vendors.commercial.read", "vendors.commercial.write", "vendors.contacts.read", "vendors.documents.read"]);
    expect(m.stage_manager).toBeUndefined();
  });

  it("task ↔ vendor link and wedding teardown cascade cleanly", async () => {
    const [v] = await sql<{ id: string }[]>`select id from vendor where wedding_id = ${fx.weddingId} limit 1`;
    const [t] = await sql<{ id: string }[]>`select id from task_create(null, ${fx.weddingId}, ${sql.json({ title: "Confirm menu", vendorId: v!.id })})`;
    await expect(sql`select task_create(null, ${fx.weddingId}, ${sql.json({ title: "Bad link", vendorId: randomUUID() })})`).rejects.toThrow(/foreign key/);
    expect((await sql`select vendor_id from task where id = ${t!.id}`)[0]!.vendor_id).toBe(v!.id);
  });
});
