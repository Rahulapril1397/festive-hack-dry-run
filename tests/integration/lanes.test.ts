import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createFixture, dropFixture } from "../../scripts/fixture";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("E2/E3 SQL (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 5, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let other: Awaited<ReturnType<typeof createFixture>>;
  let fam: string[];

  beforeAll(async () => {
    fx = await createFixture(sql, 3);
    other = await createFixture(sql, 1);
    fam = (await sql<{ id: string }[]>`select id from family where wedding_id = ${fx.weddingId} order by phone`).map((r) => r.id);
  });
  afterAll(async () => {
    if (fx) await dropFixture(sql, fx.weddingId);
    if (other) await dropFixture(sql, other.weddingId);
    await sql.end();
  });

  describe("RSVP (E2)", () => {
    it("upserts per function and persists (refresh = re-read)", async () => {
      await sql`select * from rsvp_save(${fam[0]!}, ${sql.json([{ eventId: fx.eventId, attending: true, headcount: 4 }])})`;
      await sql`select * from rsvp_save(${fam[0]!}, ${sql.json([{ eventId: fx.eventId, attending: false, headcount: 4 }])})`;
      const rows = await sql`select status, headcount from rsvp where family_id = ${fam[0]!}`;
      expect(rows).toEqual([{ status: "no", headcount: 0 }]);
    });
    it("rejects another wedding's event and headcount > 10", async () => {
      await expect(sql`select * from rsvp_save(${fam[0]!}, ${sql.json([{ eventId: other.eventId, attending: true, headcount: 1 }])})`).rejects.toThrow(/EVENT_NOT_FOUND/);
      await expect(sql`select * from rsvp_save(${fam[0]!}, ${sql.json([{ eventId: fx.eventId, attending: true, headcount: 11 }])})`).rejects.toThrow(/rsvp_headcount_max/);
    });
    it("v_event_plates sums attending headcount and counts arrivals", async () => {
      await sql`select * from rsvp_save(${fam[1]!}, ${sql.json([{ eventId: fx.eventId, attending: true, headcount: 3 }])})`;
      await sql`select checkin_join(${fam[1]!}, ${fx.eventId}, null, 'desk')`;
      const [p] = await sql`select planned_plates, arrived_families from v_event_plates where event_id = ${fx.eventId}`;
      expect(p).toEqual({ planned_plates: 3, arrived_families: 1 });
    });
  });

  describe("Shagun ledger (E3)", () => {
    let entry: string;
    it("adds entries with an audit row; amount required for cash/UPI", async () => {
      const [e] = await sql<{ id: string }[]>`select id from ledger_add(${fx.weddingId}, null, null, ${fx.eventId}, 'T-1', null, 'cash', 501, 'env')`;
      entry = e!.id;
      await expect(sql`select ledger_add(${fx.weddingId}, null, null, null, 'T-2', null, 'upi', null, null)`).rejects.toThrow(/BAD_REQUEST/);
      await sql`select ledger_add(${fx.weddingId}, null, ${fam[2]!}, null, null, 'dinner set', 'boxed_gift', null, null)`;
      const [a] = await sql`select count(*)::int n from audit_log where wedding_id = ${fx.weddingId} and action = 'ledger.add'`;
      expect(a!.n).toBe(2);
    });
    it("entries are immutable", async () => {
      await expect(sql`update ledger_entry set amount = 1 where id = ${entry}`).rejects.toThrow(/append-only/);
      await expect(sql`delete from ledger_entry where id = ${entry}`).rejects.toThrow(/append-only/);
    });
    it("reverse once; reversal nets to zero; cannot reverse twice", async () => {
      await sql`select ledger_reverse(${fx.weddingId}, null, ${entry}, 'typo')`;
      await expect(sql`select ledger_reverse(${fx.weddingId}, null, ${entry}, 'again')`).rejects.toThrow(/INVALID_TRANSITION/);
      const [s] = await sql`select sum(amount)::numeric total from ledger_entry where wedding_id = ${fx.weddingId} and payment_method = 'cash'`;
      expect(Number(s!.total)).toBe(0);
      const [v] = await sql`select is_reversed from v_ledger_entry where id = ${entry}`;
      expect(v!.is_reversed).toBe(true);
    });
    it("reconcile links an envelope to a family, only within the wedding", async () => {
      const [e] = await sql<{ id: string }[]>`select id from ledger_add(${fx.weddingId}, null, null, null, 'T-9', null, 'cash', 1100, null)`;
      await sql`select ledger_reconcile(${fx.weddingId}, null, ${e!.id}, ${fam[0]!})`;
      const [v] = await sql`select effective_family_id from v_ledger_entry where id = ${e!.id}`;
      expect(v!.effective_family_id).toBe(fam[0]);
      const [otherFam] = await sql<{ id: string }[]>`select id from family where wedding_id = ${other.weddingId}`;
      await expect(sql`select ledger_reconcile(${fx.weddingId}, null, ${e!.id}, ${otherFam!.id})`).rejects.toThrow(/NOT_FOUND/);
    });
  });

  describe("Photos (E3)", () => {
    it("calibrate → corrected_at; candidates → check; confirm → matched with family; captured_at immutable", async () => {
      const [qe] = await sql<{ id: string }[]>`select id from queue_entry where event_id = ${fx.eventId} and family_id = ${fam[1]!}`;
      const [log] = await sql<{ id: string; created_at: Date }[]>`select id, created_at from call_next(${fx.eventId}, null, 'photo-call')`;
      const [b] = await sql<{ id: string }[]>`insert into batch(event_id, camera_name) values (${fx.eventId}, 'cam') returning id`;
      const cameraSlowMs = 60_000;
      const captured = new Date(log!.created_at.getTime() - cameraSlowMs + 1000);
      const [p] = await sql<{ id: string }[]>`insert into photo(batch_id, storage_path, captured_at) values (${b!.id}, ${`x/${b!.id}/a.jpg`}, ${captured}) returning id`;

      await sql`select photo_calibrate(${b!.id}, null, ${cameraSlowMs})`;
      const [c1] = await sql<{ corrected_at: Date; captured_at: Date }[]>`select corrected_at, captured_at from photo where id = ${p!.id}`;
      expect(c1!.corrected_at.getTime() - c1!.captured_at.getTime()).toBe(cameraSlowMs);
      await expect(sql`update photo set captured_at = now() where id = ${p!.id}`).rejects.toThrow(/immutable/);

      await sql`select photo_set_candidates(${p!.id}, ${sql.json([{ stageLogId: log!.id, deltaMs: -1000 }])})`;
      const [st] = await sql`select review_status from photo where id = ${p!.id}`;
      expect(st!.review_status).toBe("check");

      const [cand] = await sql<{ id: string }[]>`select id from photo_candidate where photo_id = ${p!.id}`;
      await sql`select photo_decide(${cand!.id}, null, 'confirmed')`;
      const [done] = await sql`select review_status, family_id, stage_log_id from photo where id = ${p!.id}`;
      expect(done).toEqual({ review_status: "matched", family_id: fam[1], stage_log_id: log!.id });
      expect(qe).toBeTruthy();
      await expect(sql`select photo_decide(${cand!.id}, null, 'rejected')`).rejects.toThrow(/INVALID_TRANSITION/);
      // re-matching never touches a human decision
      await sql`select photo_set_candidates(${p!.id}, ${sql.json([])})`;
      const [still] = await sql`select review_status from photo where id = ${p!.id}`;
      expect(still!.review_status).toBe("matched");
    });

    it("reject → back to unmatched when no candidates remain", async () => {
      const [log] = await sql<{ id: string }[]>`select id from stage_log where event_id = ${fx.eventId} and action = 'called' limit 1`;
      const [b] = await sql<{ id: string }[]>`insert into batch(event_id, camera_name) values (${fx.eventId}, 'cam2') returning id`;
      const [p] = await sql<{ id: string }[]>`insert into photo(batch_id, storage_path) values (${b!.id}, ${`x/${b!.id}/b.jpg`}) returning id`;
      await sql`select photo_set_candidates(${p!.id}, ${sql.json([{ stageLogId: log!.id, deltaMs: 200 }])})`;
      const [cand] = await sql<{ id: string }[]>`select id from photo_candidate where photo_id = ${p!.id}`;
      await sql`select photo_decide(${cand!.id}, null, 'rejected')`;
      const [st] = await sql`select review_status from photo where id = ${p!.id}`;
      expect(st!.review_status).toBe("unmatched");
    });
  });

  describe("Host / kitchen / ops", () => {
    it("host_add_family returns a working 4-digit code and pending RSVPs", async () => {
      const [{ r }] = (await sql`select host_add_family(${fx.weddingId}, null, 'New Family', '9123400001', 'hi') r`) as unknown as [{ r: { familyId: string; code: string } }];
      expect(r.code).toMatch(/^\d{4}$/);
      const [{ v }] = (await sql`select checkin_verify('9123400001', ${r.code}, ${fx.eventId}) v`) as unknown as [{ v: { outcome: string } }];
      expect(v.outcome).toBe("ok");
      const [n] = await sql`select count(*)::int n from rsvp where family_id = ${r.familyId}`;
      expect(n!.n).toBe(1);
      await expect(sql`select host_add_family(${fx.weddingId}, null, 'Dup', '9123400001', 'en')`).rejects.toThrow(/FAMILY_EXISTS/);
    });
    it("host_create_event creates pending RSVPs for every family", async () => {
      const [e] = await sql<{ id: string }[]>`select id from host_create_event(${fx.weddingId}, null, 'Mehendi', null, 'en')`;
      const [n] = await sql`select count(*)::int n from rsvp where event_id = ${e!.id}`;
      const [f] = await sql`select count(*)::int n from family where wedding_id = ${fx.weddingId}`;
      expect(n!.n).toBe(f!.n);
    });
    it("meal_status_set upserts with audit", async () => {
      await sql`select meal_status_set(${fx.eventId}, null, 'serving')`;
      const [m] = await sql`select meal_status from v_event_plates where event_id = ${fx.eventId}`;
      expect(m!.meal_status).toBe("serving");
      await expect(sql`select meal_status_set(${fx.eventId}, null, 'eaten')`).rejects.toThrow(/BAD_REQUEST/);
    });
    it("recommendation: pending → approved → done; cannot approve twice", async () => {
      const [r] = await sql<{ id: string }[]>`insert into recommendation(text, proposed_action) values ('tts failing', 'voice_calls_off') returning id`;
      await sql`select recommendation_approve(${r!.id}, null, ${fx.weddingId})`;
      await expect(sql`select recommendation_approve(${r!.id}, null, ${fx.weddingId})`).rejects.toThrow(/INVALID_TRANSITION/);
      await sql`select recommendation_finish(${r!.id}, null, ${fx.weddingId}, 'done', 'read back OFF')`;
      const [d] = await sql`select status, verified_at is not null v from recommendation where id = ${r!.id}`;
      expect(d).toEqual({ status: "done", v: true });
      await sql`delete from recommendation where id = ${r!.id}`;
    });
    it("no function in public is executable by PUBLIC (anon can't /rpc)", async () => {
      const rows = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public' and has_function_privilege('public', p.oid, 'execute')`;
      expect(rows.map((r) => r.proname)).toEqual([]);
    });
  });
});
