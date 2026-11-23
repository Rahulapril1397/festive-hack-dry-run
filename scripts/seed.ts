/**
 * Seed the demo wedding.  Usage:
 *   npm run seed                 # needs DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_USER_PASSWORD, APP_URL
 *   npx tsx scripts/seed.ts --print-sql   # just print the data SQL (no auth users)
 * Refuses to run when APP_ENV=production unless --allow-production is passed (demo wedding on a
 * prod-only setup). It only ever replaces the demo wedding, never other data.
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { DEMO_EVENTS, DEMO_ROLES, demoEmail, demoFamilies, demoSql } from "./demoData";

async function ensureAuthUsers(): Promise<{ id: string; email: string; role: string }[]> {
  const url = must("SUPABASE_URL");
  const key = must("SUPABASE_SERVICE_ROLE_KEY");
  const password = must("SEED_USER_PASSWORD");
  const admin = createClient(url, key, { auth: { persistSession: false } }).auth.admin;

  const { data: list, error } = await admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const out: { id: string; email: string; role: string }[] = [];
  for (const role of DEMO_ROLES) {
    const email = demoEmail(role);
    const existing = list.users.find((u) => u.email === email);
    if (existing) {
      await admin.updateUserById(existing.id, { password });
      out.push({ id: existing.id, email, role });
    } else {
      const { data, error: e } = await admin.createUser({ email, password, email_confirm: true });
      if (e || !data.user) throw e ?? new Error(`createUser ${email}`);
      out.push({ id: data.user.id, email, role });
    }
  }
  return out;
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  if (process.argv.includes("--print-sql")) {
    console.log(demoSql());
    return;
  }
  if (process.env.APP_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw new Error("Refusing to seed production (pass --allow-production to seed the demo wedding anyway)");
  }

  const users = await ensureAuthUsers();
  const sql = postgres(must("DATABASE_URL"), { max: 1 });
  try {
    await sql.unsafe(demoSql(users));
  } finally {
    await sql.end();
  }

  const app = process.env.APP_URL ?? "http://localhost:3000";
  console.log("\nDemo wedding seeded: Demo: Aarav and Meera\n");
  console.log("Staff logins (password = SEED_USER_PASSWORD):");
  users.forEach((u) => console.log(`  ${u.role.padEnd(13)} ${u.email}`));
  console.log("\nEvents:");
  for (const e of DEMO_EVENTS) {
    console.log(`  ${e.name.padEnd(10)} check-in ${app}/checkin?event=${e.id}`);
    console.log(`  ${"".padEnd(10)} TV       ${app}/tv/${e.id}?key=${e.tvKey}`);
  }
  console.log("\nFamilies (phone / code / link):");
  console.table(demoFamilies().map((f) => ({ name: f.name, phone: f.phone, code: f.code, lang: f.language, rsvp: f.rsvpYes ? "yes" : "", link: `${app}/f/${f.linkKey}` })));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
