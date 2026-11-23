/**
 * Bootstrap or add a super admin (wedding-less role) for an existing staff user, audited.
 *   DATABASE_URL=… node scripts/grant-super-admin.mjs someone@example.com
 * The user must have signed in or been invited once (an app_user row exists).
 */
import postgres from "postgres";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email || !process.env.DATABASE_URL) {
  console.error("usage: DATABASE_URL=… node scripts/grant-super-admin.mjs <email>");
  process.exit(2);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  const [u] = await sql`select id from app_user where lower(email) = ${email}`;
  if (!u) throw new Error(`No staff user with email ${email}. Invite them first (Users and Roles), or seed.`);
  const [r] = await sql`select id from role where key = 'super_admin'`;
  await sql`select admin_assign(null, ${u.id}, null, ${r.id}, null, null)`;
  const [{ n }] = await sql`select authz.active_super_admins() n`;
  console.log(`${email} is now a super admin (${n} active super admin(s)).`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
