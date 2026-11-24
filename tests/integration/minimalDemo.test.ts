import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createFixture, dropFixture } from "../../scripts/fixture";
import { applyPlan, resetDemo } from "../../scripts/photo-demo";
import { planDemo, type DemoPhoto } from "@/domain/photos/demoPlan";
import { matchPhoto } from "@/domain/photos/match";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("minimal demo: languages and photo demo seed (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 4, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture(sql, 12);
  });
  afterAll(async () => {
    if (fx) await dropFixture(sql, fx.weddingId);
    await sql.end();
  });

  it("0122: the eight languages exist, a family can use one, and the group is A or B only", async () => {
    const [{ langs }] = (await sql`select enum_range(null::app_language)::text[] as langs`) as unknown as [{ langs: string[] }];
    expect(langs).toEqual(expect.arrayContaining(["en", "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa"]));
    const [f] = await sql<{ id: string }[]>`select id from family where wedding_id = ${fx.weddingId} limit 1`;
    await sql`update family set language = 'ta', language_group = 'B' where id = ${f!.id}`;
    expect((await sql`select language, language_group from family where id = ${f!.id}`)[0]).toEqual({ language: "ta", language_group: "B" });
    await expect(sql`update family set language_group = 'C' where id = ${f!.id}`).rejects.toThrow();
    // a translation can be cached in a new language too
    await sql`insert into translation(wedding_id, language, source_text, text) values (${fx.weddingId}, 'ta', 'Save RSVP', 'ஆர்எஸ்விபி சேமி')`;
  });

  const T0 = Date.UTC(2026, 11, 13, 14, 0, 0);
  const photos: DemoPhoto[] = Array.from({ length: 12 }, (_, i) => ({ name: `p${i + 1}.jpg`, ms: T0 + i * 60_000 }));

  it("seed: stage events land in the database and the real matcher gives the planned buckets", async () => {
    const plan = planDemo(photos);
    const r = await applyPlan(sql, fx.eventId, plan);
    expect(r).toEqual({ events: 10, families: 10 });
    const logs = await sql`select id, action, created_at, queue_entry_id, token_number from stage_log where event_id = ${fx.eventId} and idempotency_key like 'photo-demo:%'`;
    const lite = logs.map((l) => ({ id: l.id as string, action: l.action as string, createdMs: new Date(l.created_at as string).getTime(), queueEntryId: l.queue_entry_id as string, token: l.token_number as number }));
    const counts = photos.map((p) => matchPhoto(p.ms, lite).length);
    expect(counts.filter((c) => c > 0)).toHaveLength(plan.expected.check);
    expect(counts.filter((c) => c > 1)).toHaveLength(plan.expected.ambiguous);
    expect(counts.filter((c) => c === 0)).toHaveLength(plan.expected.unmatched);
    // the seeded queue entries are served, so the live queue is untouched
    const [{ waiting }] = (await sql`select count(*)::int waiting from queue_entry where event_id = ${fx.eventId} and status = 'waiting'`) as unknown as [{ waiting: number }];
    expect(waiting).toBe(0);
  });

  it("seed refuses when there are not enough families outside the queue", async () => {
    await expect(applyPlan(sql, fx.eventId, planDemo(photos))).rejects.toThrow(/need 10 families/);
  });

  it("reset removes the uploaded batch; with events it also removes the seeded events and entries", async () => {
    const [b] = await sql<{ id: string }[]>`insert into batch(event_id, camera_name) values (${fx.eventId}, 'Demo cam') returning id`;
    await sql`insert into photo(batch_id, storage_path, captured_at, corrected_at) values (${b!.id}, ${`t/${randomUUID()}.jpg`}, now(), now())`;
    const a = await resetDemo(sql, fx.eventId, false);
    expect(a).toEqual({ batches: 1, events: 0 });
    expect((await sql`select count(*)::int n from stage_log where event_id = ${fx.eventId} and idempotency_key like 'photo-demo:%'`)[0]!.n).toBe(10);
    const c = await resetDemo(sql, fx.eventId, true);
    expect(c.events).toBe(10);
    expect((await sql`select count(*)::int n from queue_entry where event_id = ${fx.eventId}`)[0]!.n).toBe(0);
    // and the seed can run again
    expect(await applyPlan(sql, fx.eventId, planDemo(photos))).toEqual({ events: 10, families: 10 });
  });
});
