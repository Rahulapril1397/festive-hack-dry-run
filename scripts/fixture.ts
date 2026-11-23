import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

/** Throwaway wedding + event + n families (code "1234") for tests. */
export async function createFixture(sql: Sql, n: number) {
  const weddingId = randomUUID();
  const eventId = randomUUID();
  await sql`insert into wedding(id, name) values (${weddingId}, ${"test-" + weddingId.slice(0, 8)})`;
  await sql`insert into event(id, wedding_id, name) values (${eventId}, ${weddingId}, 'Test event')`;
  const prefix = String(6000 + Math.floor(Math.random() * 3999)); // 4 digits, starts 6–9
  const phones = Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(6, "0")}`);
  for (const phone of phones) {
    const [f] = await sql<{ id: string }[]>`insert into family(wedding_id, name, phone) values (${weddingId}, ${"F " + phone}, ${phone}) returning id`;
    await sql`select set_checkin_code(${f!.id}, '1234')`;
  }
  return { weddingId, eventId, phones };
}

/** Remove a fixture, including its append-only stage_log rows (table owner only). */
export async function dropFixture(sql: Sql, weddingId: string) {
  await sql.begin(async (tx) => {
    await tx`alter table stage_log disable trigger stage_log_no_update_delete`;
    await tx`delete from stage_log where event_id in (select id from event where wedding_id = ${weddingId})`;
    await tx`alter table stage_log enable trigger stage_log_no_update_delete`;
    await tx`delete from wedding where id = ${weddingId}`;
  });
}
