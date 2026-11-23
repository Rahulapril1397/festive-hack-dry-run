/** Run one SQL file against DATABASE_URL (used by deploy/rollback-stage2.sh). */
import postgres from "postgres";
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error("usage: DATABASE_URL=… node scripts/run-sql.mjs <file.sql>");
  process.exit(2);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync(file, "utf8"));
  console.log(`applied ${file}`);
} catch (e) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
