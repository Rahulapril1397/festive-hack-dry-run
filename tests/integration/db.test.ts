import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createFixture, dropFixture } from "../../scripts/fixture";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("database (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 5, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture(sql, 4);
    for (const p of fx.phones) await sql`select checkin_verify(${p}, '1234', ${fx.eventId})`;
  });
  afterAll(async () => {
    if (fx) await dropFixture(sql, fx.weddingId);
    await sql.end();
  });

  it("stage_log rejects UPDATE and DELETE", async () => {
    const [row] = await sql<{ id: string }[]>`select id from call_next(${fx.eventId}, null, 'append-1')`;
    await expect(sql`update stage_log set actor = null where id = ${row!.id}`).rejects.toThrow(/append-only/);
    await expect(sql`delete from stage_log where id = ${row!.id}`).rejects.toThrow(/append-only/);
  });

  it("replaying an idempotency key returns the same stage_log row and calls no one else", async () => {
    const [a] = await sql<{ id: string; token_number: number }[]>`select * from call_next(${fx.eventId}, null, 'replay-1')`;
    const [b] = await sql<{ id: string; token_number: number }[]>`select * from call_next(${fx.eventId}, null, 'replay-1')`;
    expect(b!.id).toBe(a!.id);
    expect(b!.token_number).toBe(a!.token_number);
    const [{ n }] = (await sql`select count(*)::int n from stage_log where event_id = ${fx.eventId} and action = 'called'`) as unknown as [{ n: number }];
    expect(n).toBe(2);
  });

  it("pause blocks call next; resume allows it", async () => {
    await sql`select queue_action(${fx.eventId}, null, 'pause-1', 'paused')`;
    await expect(sql`select call_next(${fx.eventId}, null, 'after-pause')`).rejects.toThrow(/QUEUE_PAUSED/);
    await sql`select queue_action(${fx.eventId}, null, 'resume-1', 'resumed')`;
    await sql`select call_next(${fx.eventId}, null, 'after-resume')`;
  });

  it("empty queue → QUEUE_EMPTY", async () => {
    await sql`select call_next(${fx.eventId}, null, 'drain-4')`.catch(() => {});
    await expect(sql`select call_next(${fx.eventId}, null, 'drain-5')`).rejects.toThrow(/QUEUE_EMPTY/);
  });

  it("check-in verify: success says outcome ok (and keeps queue status separately); 5 failures lock", async () => {
    const [{ r }] = (await sql`select checkin_verify(${fx.phones[0]!}, '1234', ${fx.eventId}) r`) as unknown as [{ r: Record<string, unknown> }];
    expect(r.outcome).toBe("ok");
    expect(typeof r.token).toBe("number");
    const p = fx.phones[3]!;
    for (let i = 0; i < 4; i++) {
      const [{ r: bad }] = (await sql`select checkin_verify(${p}, '0000', ${fx.eventId}) r`) as unknown as [{ r: { outcome: string } }];
      expect(bad.outcome).toBe("invalid");
    }
    const [{ r: fifth }] = (await sql`select checkin_verify(${p}, '0000', ${fx.eventId}) r`) as unknown as [{ r: { outcome: string } }];
    expect(fifth.outcome).toBe("locked");
    const [{ r: right }] = (await sql`select checkin_verify(${p}, '1234', ${fx.eventId}) r`) as unknown as [{ r: { outcome: string } }];
    expect(right.outcome).toBe("locked");
    const [{ r: unknown }] = (await sql`select checkin_verify('9000000000', '1234', ${fx.eventId}) r`) as unknown as [{ r: { outcome: string } }];
    expect(unknown.outcome).toBe("invalid");
  });

  it("tv_feed exposes no private columns", async () => {
    const cols = await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'tv_feed' order by 1`;
    expect(cols.map((c) => c.column_name)).toEqual(["announcement_id", "event_id", "instruction", "language", "next_token", "token", "updated_at"]);
  });
});
