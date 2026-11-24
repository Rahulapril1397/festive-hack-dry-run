#!/usr/bin/env node
/**
 * Access matrix: signs in as every demo role for real, then requests every guarded page and API
 * route and checks the answer against what that user's permissions in the database allow.
 *
 *   node scripts/access-matrix.mjs [--base=http://localhost:3000]      # default: local dev server
 *   ACCESS_PASSWORDS='{"vendor":"…","helper":"…"}' ACCESS_EMAILS='{"super_admin":"…"}' node scripts/access-matrix.mjs --base=https://…
 *
 * Expected results are computed, not hand-written: required permissions come from the route audit
 * (npm run audit:routes) and the page files; each user's permissions come from
 * authz.effective_permissions. Allowed = anything but 401/403 (a wrong body may still 400/404);
 * denied = exactly 403 for APIs, a redirect (not to login) for pages.
 * Mutating routes are called with an empty body and a non-existent id, so nothing is changed.
 * Exits 1 on any mismatch. Needs .env.local (Supabase, DATABASE_URL, SEED_USER_PASSWORD).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import postgres from "postgres";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/\s+#.*$/, "").trim().replace(/^"|"$/g, "")]));
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "http://localhost:3000").replace(/\/$/, "");
const WEDDING = "00000000-0000-4000-8000-000000000001";
const RECEPTION = "00000000-0000-4000-8000-0000000000a3";
const DUMMY = "00000000-0000-4000-8000-0000000000ff";
const pw = { ...JSON.parse(process.env.ACCESS_PASSWORDS || "{}") };
const emails = { ...JSON.parse(process.env.ACCESS_EMAILS || "{}") };
const ROLES = [
  ["super_admin", "superadmin"], ["admin", "admin"], ["host", "host"], ["coordinator", "coordinator"], ["stage_manager", "stage"],
  ["finance", "finance"], ["kitchen", "kitchen"], ["photographer", "photographer"], ["vendor", "vendor"], ["helper", "helper"],
].map(([role, local]) => ({ role, email: emails[role] ?? `${local}@demo.pehleaap.test`, password: pw[role] ?? env.SEED_USER_PASSWORD }));

// ── what each route / page needs ───────────────────────────────────────────────────────────
const audit = JSON.parse(execFileSync("npx", ["tsx", "scripts/route-audit.ts", "--json"], { encoding: "utf8", maxBuffer: 20e6 }));
const SKIP_API = [/^\/api\/queue\//, /^\/api\/checkin\//, /^\/api\/tv\//, /^\/api\/admin\/users\/\[id\]\/(suspend|reactivate)/, /^\/api\/notifications/, /^\/api\/auth\//];
const apiTests = audit.rows
  .filter((r) => r.permissions.length && !r.publicReason && !SKIP_API.some((re) => re.test(r.route)) && r.route !== "/api/assistant/message" && r.route !== "/api/assistant/voice")
  .map((r) => ({ kind: "api", method: r.method, path: r.route.replace(/\[[^\]]+\]/g, DUMMY), need: r.permissions, label: `${r.method} ${r.route}` }));
// reads that are safe with the real event id
for (const [path, need, method] of [[`/api/queue/${RECEPTION}`, ["queue.read"]], ["/api/clock/now", ["clock.read"]], [`/api/checkin/lookup?eventId=${RECEPTION}&q=zzzz`, ["queue.checkin"]], [`/api/queue/${DUMMY}`, ["queue.read"]], [`/api/queue/${DUMMY}/call-next`, ["queue.call_next"], "POST"]]) apiTests.push({ kind: "api", method: method ?? "GET", path, need, label: `${method ?? "GET"} ${path.replace(RECEPTION, "[event]").replace(DUMMY, "[unknown event]")}` });
// PinkyBua: staff mode is admin / super admin only
apiTests.push({ kind: "api", method: "GET", path: "/api/assistant/voice?mode=staff", need: "ADMIN_ONLY", label: "GET /api/assistant/voice?mode=staff" });
apiTests.push({ kind: "api", method: "POST", path: "/api/assistant/message", body: { mode: "staff", text: "." }, need: "ADMIN_ONLY", label: "POST /api/assistant/message (staff)", onlyDenied: true });

const TILE = { vendors: ["vendors.contacts.read", "vendors.manage", "vendors.commercial.read"], readiness: ["tasks.read", "host.read"], tasks: ["tasks.read"], ledger: ["ledger.read", "ledger.write"] };
const pageTests = [];
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
for (const f of walk("src/app").filter((f) => f.endsWith("/page.tsx"))) {
  const path = "/" + relative("src/app", f).replace(/\/page\.tsx$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/");
  if (/^\/(login|checkin|tv|f|denied|no-access|soon)\b/.test(path) || path === "/") continue;
  const src = readFileSync(f, "utf8");
  const m = /requirePage\(\s*"([a-z_.]+)"/.exec(src);
  let need = m ? [m[1]] : null;
  if (path === "/demo/[tile]") { for (const [t, keys] of Object.entries(TILE)) pageTests.push({ kind: "page", path: `/demo/${t}`, need: keys, label: `PAGE /demo/${t}` }); continue; }
  if (path === "/ledger") need = ["ledger.read", "ledger.write"];
  if (path === "/ops/recommendations") need = ["ops.approve"];
  if (path === "/stage/checkin") need = ["queue.checkin"];
  if (path === "/stage/[eventId]") need = ["queue.read"];
  if (!need) { console.log(`note: no permission found for page ${path}`); continue; }
  pageTests.push({ kind: "page", path: path.replace("[eventId]", RECEPTION).replace(/\[[^\]]+\]/g, DUMMY), need, label: `PAGE ${path}` });
}

// ── sign in + permissions ──────────────────────────────────────────────────────────────────
async function signIn(u) {
  const jar = new Map();
  const sb = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await sb.auth.signInWithPassword({ email: u.email, password: u.password });
  return error ? null : [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}
const sql = postgres(env.DATABASE_URL, { max: 1 });
async function permsOf(email) {
  const [u] = await sql`select id from app_user where email = ${email}`;
  if (!u) return null;
  const [r] = await sql`select authz.effective_permissions(${u.id}, ${WEDDING}) p`;
  return new Set(r.p);
}

async function hit(cookie, t) {
  const init = { method: t.method ?? "GET", redirect: "manual", headers: { cookie, ...(t.method && t.method !== "GET" ? { "content-type": "application/json", "idempotency-key": "access-matrix-" + Math.random().toString(36).slice(2) } : {}) } };
  if (t.method && t.method !== "GET") init.body = JSON.stringify(t.body ?? {});
  const r = await fetch(BASE + t.path, init);
  return { status: r.status, location: r.headers.get("location") ?? "" };
}

const problems = [];
const summary = [];
for (const u of ROLES) {
  const cookie = await signIn(u);
  const perms = await permsOf(u.email);
  if (!cookie || !perms) { problems.push(`${u.role}: cannot sign in or no user (${u.email})`); summary.push(`${u.role.padEnd(14)} SKIPPED`); continue; }
  const isAdmin = u.role === "admin" || u.role === "super_admin";
  let ok = 0, allowed = 0, denied = 0;
  for (const t of [...apiTests, ...pageTests]) {
    const can = t.need === "ADMIN_ONLY" ? isAdmin : t.need.some((k) => perms.has(k));
    if (t.onlyDenied && can) continue; // do not spend a model call on allowed callers
    let res;
    try { res = await hit(cookie, t); } catch (e) { problems.push(`${u.role} ${t.label}: request failed (${e.message})`); continue; }
    let pass;
    if (t.kind === "api") pass = can ? res.status !== 401 && res.status !== 403 : res.status === 403;
    else pass = can ? res.status === 200 || res.status === 404 : res.status >= 300 && res.status < 400 && !/\/login/.test(res.location);
    if (pass) { ok++; if (can) allowed++; else denied++; }
    else problems.push(`${u.role.padEnd(13)} ${t.label.padEnd(52)} expected ${can ? "ALLOW" : "DENY "} got ${res.status}${res.location ? " → " + res.location : ""}`);
  }
  summary.push(`${u.role.padEnd(14)} ${String(perms.size).padStart(2)} permissions · ${ok} ok (${allowed} allowed, ${denied} denied)`);
}

// ── not signed in ──────────────────────────────────────────────────────────────────────────
let anon = 0;
for (const t of [...apiTests, ...pageTests]) {
  const r = await hit("", t);
  const pass = t.kind === "api" ? r.status === 401 : r.status >= 300 && r.status < 400 && /\/login/.test(r.location);
  if (pass) anon++; else problems.push(`anonymous     ${t.label.padEnd(52)} expected sign-in required, got ${r.status} ${r.location}`);
}
await sql.end();

console.log(`Base ${BASE} · ${apiTests.length} API routes + ${pageTests.length} pages per role\n`);
console.log(summary.join("\n"));
console.log(`${"anonymous".padEnd(14)} ${anon}/${apiTests.length + pageTests.length} correctly asked to sign in`);
console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n` + problems.join("\n") : "\nNo mismatches: every role gets exactly the access its permissions allow.");
process.exit(problems.length ? 1 : 0);
