/**
 * Pin two demo families to the language A/B groups and reset them so the language screen shows
 * again (additive: touches only these two family records).
 *
 *   DATABASE_URL=… APP_URL=https://… npx tsx scripts/pin-demo-families.ts
 *
 * Family #1 → group A (English and Hindi), family #2 → group B (English, Hindi and the dropdown of
 * the other Indian languages). Prints both links. Run it again before each rehearsal.
 */
import postgres from "postgres";
import { DEMO_WEDDING_ID, demoFamilies } from "./demoData";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const app = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [a, b] = demoFamilies();
  const sql = postgres(url, { max: 1 });
  try {
    for (const [fam, group] of [[a!, "A"], [b!, "B"]] as const) {
      const r = await sql`update family set language = 'en', language_source = 'default', language_group = ${group}
                           where id = ${fam.id} and wedding_id = ${DEMO_WEDDING_ID} returning name, link_key`;
      if (!r.length) throw new Error(`demo family ${fam.name} not found (is the demo wedding seeded?)`);
      console.log(`group ${group}  ${r[0]!.name.padEnd(24)} ${app}/f/${r[0]!.link_key}`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
