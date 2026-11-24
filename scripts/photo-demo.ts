/**
 * Photo matching demo data (additive: never deletes the demo wedding, its families or RSVPs).
 *
 *   npx tsx scripts/photo-demo.ts seed <folder-of-jpegs> [--event=Reception] [--wedding=<uuid>]
 *       Reads each photo's capture time (the same way the app does), then adds stage events for the
 *       Reception around those times so about 6 photos get one suggested family, 2 get two, and the
 *       rest get none. Prints the buckets the review screen will show after the batch is uploaded.
 *   npx tsx scripts/photo-demo.ts reset [--with-events] [--event=Reception] [--wedding=<uuid>]
 *       Removes the uploaded demo batch(es) (photos + matches) so the upload can be run again.
 *       --with-events also removes the stage events this script added (needs the table owner).
 *
 * Needs DATABASE_URL. The seeded events are tagged by idempotency key "photo-demo:…".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import exifr from "exifr";
import { exifToEpochMs } from "../src/domain/photos/time";
import { planDemo, type DemoPhoto, type DemoPlan } from "../src/domain/photos/demoPlan";
import { DEMO_WEDDING_ID } from "./demoData";

const TAG = "photo-demo:";

export async function readPhotoTimes(folder: string): Promise<DemoPhoto[]> {
  const out: DemoPhoto[] = [];
  for (const name of readdirSync(folder).filter((f) => /\.(jpe?g)$/i.test(f)).sort()) {
    const t = (await exifr.parse(readFileSync(join(folder, name)), { pick: ["DateTimeOriginal", "SubSecTimeOriginal", "OffsetTimeOriginal"], reviveValues: false }).catch(() => null)) as { DateTimeOriginal?: string; SubSecTimeOriginal?: string | number; OffsetTimeOriginal?: string } | null;
    const ms = exifToEpochMs(t?.DateTimeOriginal, t?.SubSecTimeOriginal, t?.OffsetTimeOriginal);
    if (ms === null) console.warn(`skipping ${name}: no capture time in the file`);
    else out.push({ name, ms });
  }
  return out;
}

/** Add the planned stage events. Families that are not already in this event's queue are used, and marked served so the live queue is untouched. */
export async function applyPlan(sql: Sql, eventId: string, plan: DemoPlan): Promise<{ events: number; families: number }> {
  const [ev] = await sql<{ wedding_id: string }[]>`select wedding_id from event where id = ${eventId}`;
  if (!ev) throw new Error("event not found");
  const fams = await sql<{ id: string }[]>`
    select f.id from family f where f.wedding_id = ${ev.wedding_id}
       and not exists (select 1 from queue_entry q where q.event_id = ${eventId} and q.family_id = f.id)
     order by f.name limit ${plan.families}`;
  if (fams.length < plan.families) throw new Error(`need ${plan.families} families that are not in the queue yet, found ${fams.length}`);
  const entries: { entryId: string; token: number }[] = [];
  for (const f of fams) {
    const [{ r }] = (await sql`select checkin_join(${f.id}, ${eventId}, null, 'desk') r`) as unknown as [{ r: { entryId: string; token: number } }];
    entries.push(r);
  }
  let n = 0;
  await sql.begin(async (tx) => {
    for (const [i, e] of plan.events.entries()) {
      const entry = entries[e.familyIndex]!;
      const key = `${TAG}${eventId}:${i}`;
      const done = await tx`insert into stage_log(event_id, queue_entry_id, token_number, action, idempotency_key, created_at)
                            values (${eventId}, ${entry.entryId}, ${entry.token}, 'on_stage', ${key}, ${new Date(e.atMs).toISOString()}) on conflict (event_id, idempotency_key) do nothing returning id`;
      n += done.length;
    }
    for (const e of entries) await tx`update queue_entry set status = 'served', called_at = now() where id = ${e.entryId}`;
  });
  await sql`select refresh_tv_feed(${eventId})`;
  return { events: n, families: entries.length };
}

/** Remove uploaded demo batches for the event; with `withEvents`, also the events this script added. */
export async function resetDemo(sql: Sql, eventId: string, withEvents: boolean) {
  const gone = await sql`delete from batch where event_id = ${eventId} returning id`;
  let events = 0;
  if (withEvents) {
    await sql.begin(async (tx) => {
      await tx`alter table stage_log disable trigger stage_log_no_update_delete`;
      const rows = await tx`delete from stage_log where event_id = ${eventId} and idempotency_key like ${TAG + "%"} returning queue_entry_id`;
      events = rows.length;
      const ids = [...new Set(rows.map((r) => r.queue_entry_id as string).filter(Boolean))];
      if (ids.length) {
        await tx`delete from stage_log where queue_entry_id = any(${ids})`; // any later real calls for the same seeded entries
        await tx`delete from queue_entry where id = any(${ids}) and status = 'served'`;
      }
      await tx`alter table stage_log enable trigger stage_log_no_update_delete`;
    });
  }
  return { batches: gone.length, events };
}

async function main() {
  const [cmd, folder] = process.argv.slice(2);
  const arg = (k: string, d = "") => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const wedding = arg("wedding", DEMO_WEDDING_ID);
    const [ev] = await sql<{ id: string }[]>`select id from event where wedding_id = ${wedding} and name = ${arg("event", "Reception")}`;
    if (!ev) throw new Error("event not found (use --event=<name> and --wedding=<uuid>)");
    if (cmd === "seed") {
      if (!folder) throw new Error("usage: seed <folder-of-jpegs>");
      const photos = await readPhotoTimes(folder);
      if (photos.length < 4) throw new Error(`found ${photos.length} photos with a capture time; need at least 4`);
      const plan = planDemo(photos);
      const r = await applyPlan(sql, ev.id, plan);
      console.log(`${photos.length} photos read. Added ${r.events} stage events for ${r.families} families.`);
      console.log(`After the upload the review screen should show: Check this ${plan.expected.check} (of which ${plan.expected.ambiguous} with two candidates), Unmatched ${plan.expected.unmatched}.`);
      for (const p of plan.perPhoto) console.log(`  ${p.name.padEnd(32)} ${p.candidates === 0 ? "unmatched" : p.candidates === 1 ? "check this" : "check this (2 candidates)"}`);
    } else if (cmd === "reset") {
      const r = await resetDemo(sql, ev.id, process.argv.includes("--with-events"));
      console.log(`Removed ${r.batches} uploaded batch(es)${process.argv.includes("--with-events") ? ` and ${r.events} seeded stage events` : ""}.`);
    } else {
      throw new Error("usage: photo-demo.ts seed <folder> | reset [--with-events]");
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && /photo-demo\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
