/**
 * Apply supabase/migrations/*.sql in order, each in its own transaction, recording what ran in
 * pehle_meta.migration. Safe to re-run. A database migrated earlier by hand (psql / supabase db
 * push) is detected by marker objects and back-filled, so nothing runs twice.
 *   DATABASE_URL=… npm run migrate            (add --dry-run to only list pending files)
 * Plain JavaScript so it also runs inside the production image (Helm pre-upgrade hook Job).
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");

/** One object each migration creates; used only to back-fill pre-existing databases. */
/** @type {Record<string, string>} */
const MARKERS = {
  "0001_core.sql": "select to_regclass('public.stage_log') is not null as ok",
  "0002_queue.sql": "select to_regproc('public.call_next') is not null as ok",
  "0003_platform.sql": "select to_regproc('public.lock_down_public') is not null as ok",
  "0101_guest.sql": "select to_regclass('public.recommendation') is not null as ok",
  "0201_views.sql": "select to_regclass('public.v_event_plates') is not null as ok",
  "0202_ledger.sql": "select to_regclass('public.ledger_reconciliation') is not null as ok",
  "0203_photos.sql": "select to_regproc('public.photo_decide') is not null as ok",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const dry = process.argv.includes("--dry-run");
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    await sql`create schema if not exists pehle_meta`;
    await sql`create table if not exists pehle_meta.migration (name text primary key, applied_at timestamptz not null default now())`;
    await sql`revoke all on schema pehle_meta from public`;

    const files = readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    let applied = new Set((await sql`select name from pehle_meta.migration`).map((r) => r.name));

    if (applied.size === 0) {
      const found = [];
      // Each marker is checked on its own: a newer migration can sort between older ones.
      for (const f of files) {
        const q = MARKERS[f];
        if (!q) continue;
        const [r] = await sql.unsafe(q);
        if (r?.ok) found.push(f);
      }
      if (found.length) {
        console.log(`Existing schema detected; recording ${found.length} migration(s) as already applied.`);
        if (!dry) for (const f of found) await sql`insert into pehle_meta.migration(name) values (${f}) on conflict do nothing`;
        applied = new Set(found);
      }
    }

    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) return console.log(`Database is up to date (${files.length} migrations).`);
    for (const f of pending) {
      if (dry) {
        console.log(`pending  ${f}`);
        continue;
      }
      process.stdout.write(`applying ${f} … `);
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(DIR, f), "utf8"));
        await tx`insert into pehle_meta.migration(name) values (${f})`;
      });
      console.log("ok");
    }
  } finally {
    await sql.end();
  }
}

main().catch((/** @type {Error} */ e) => {
  console.error(`\nMigration failed: ${e.message}`);
  process.exit(1);
});
