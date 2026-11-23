/**
 * Concurrency checks against a real database (DATABASE_URL). Exits non-zero on failure.
 *   1. 50 parallel check-ins → 50 distinct, gap-free tokens
 *   2. 30 parallel call-next with distinct keys → 30 different families, none twice
 *   3. one key replayed 20× in parallel → one stage_log row, one family called
 * Creates and removes its own throwaway wedding. Refuses APP_ENV=production.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { createFixture, dropFixture } from "./fixture";

if (process.env.APP_ENV === "production") throw new Error("Refusing to run against production");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const sql = postgres(url, { max: 60, onnotice: () => {} });
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function main() {
  const fx = await createFixture(sql, 50);
  try {
    // 1 — check-ins
    const results = await Promise.allSettled(
      fx.phones.map((p) => sql<{ r: { outcome: string; token: number } }[]>`select checkin_verify(${p}, '1234', ${fx.eventId}) r`),
    );
    const tokens = results.flatMap((r) => (r.status === "fulfilled" && r.value[0]!.r.outcome === "ok" ? [r.value[0]!.r.token] : []));
    const failed = results.length - tokens.length;
    const distinct = new Set(tokens);
    check(distinct.size === tokens.length, `check-in: ${tokens.length} tokens, ${distinct.size} distinct (${failed} failed)`);
    const sorted = [...distinct].sort((a, b) => a - b);
    check(sorted.length > 0 && sorted[sorted.length - 1]! - sorted[0]! + 1 === sorted.length, `check-in: tokens ${sorted[0]}..${sorted.at(-1)} have no gaps`);

    // 2 — parallel call-next
    const calls = await Promise.allSettled(
      Array.from({ length: 30 }, () => sql<{ queue_entry_id: string }[]>`select queue_entry_id from call_next(${fx.eventId}, null, ${randomUUID()})`),
    );
    const entries = calls.flatMap((c) => (c.status === "fulfilled" ? [c.value[0]!.queue_entry_id] : []));
    check(entries.length === 30, `call-next: ${entries.length}/30 succeeded`);
    check(new Set(entries).size === entries.length, `call-next: no family called twice (${new Set(entries).size} distinct)`);

    // 3 — same key replayed
    const key = randomUUID();
    const replays = await Promise.all(Array.from({ length: 20 }, () => sql<{ id: string }[]>`select id from call_next(${fx.eventId}, null, ${key})`));
    const ids = new Set(replays.map((r) => r[0]!.id));
    check(ids.size === 1, `replay: 20 concurrent requests with one key → ${ids.size} stage_log row(s)`);
    const [{ n }] = (await sql`select count(*)::int n from queue_entry where event_id = ${fx.eventId} and status = 'called'`) as unknown as [{ n: number }];
    check(n === 31, `replay: ${n} families called in total (expected 31)`);
  } finally {
    await dropFixture(sql, fx.weddingId);
    await sql.end();
  }
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll concurrency checks passed");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
