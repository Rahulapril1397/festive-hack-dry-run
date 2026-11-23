/**
 * Create a staff login (Supabase Auth email + password, email pre-confirmed) and its app_user row.
 * Prints the generated password once. Does not assign a role; deploy-stage2.sh / the admin UI do.
 *
 *   node scripts/create-staff-user.mjs <email> [--name="Rahul Kumar"] [--reset-password]
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (e.g. from .env.local).
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomInt } from "node:crypto";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const name = process.argv.find((a) => a.startsWith("--name="))?.slice(7) ?? null;
const reset = process.argv.includes("--reset-password");
const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"].filter((k) => !process.env[k]);
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || need.length) {
  console.error(`usage: node scripts/create-staff-user.mjs <email> [--name=…] [--reset-password]${need.length ? `\nmissing env: ${need.join(", ")}` : ""}`);
  process.exit(2);
}

/** 4 groups of 4 from an unambiguous alphabet (~76 bits), e.g. "kT7m-Qx3R-…". */
function newPassword() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("");
  let p;
  do p = [group(), group(), group(), group()].join("-");
  while (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/\d/.test(p));
  return p;
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).auth.admin;
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

async function findUser() {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u || data.users.length < 1000) return u ?? null;
  }
  return null;
}

try {
  let user = await findUser();
  let password = null;
  if (!user) {
    password = newPassword();
    const { data, error } = await admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { name } : {} });
    if (error) throw error;
    user = data.user;
    console.log(`created login ${email}`);
  } else if (reset) {
    password = newPassword();
    const { error } = await admin.updateUserById(user.id, { password });
    if (error) throw error;
    console.log(`reset password for existing login ${email}`);
  } else {
    console.log(`login ${email} already exists (password unchanged; use --reset-password to set a new one)`);
  }
  await sql`insert into app_user(id, email, display_name) values (${user.id}, ${email}, ${name})
            on conflict (id) do update set email = excluded.email, display_name = coalesce(excluded.display_name, app_user.display_name)`;
  console.log(`staff record ready (id ${user.id})`);
  if (password) console.log(`PASSWORD: ${password}`);
} catch (e) {
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
