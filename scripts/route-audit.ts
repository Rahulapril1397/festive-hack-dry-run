/**
 * Route audit (Stage 2, E1 T2). Lists every route handler and server action and fails when one
 * neither checks a permission nor is explicitly marked publicRoute("<why it is safe>").
 *
 *   npm run audit:routes            # table + exit 1 on gaps
 *   npm run audit:routes -- --json  # machine-readable (used by tests/unit/routeAudit.test.ts)
 *
 * A handler is guarded when its body calls one of GUARDS. Every guard other than publicRoute must
 * itself (transitively) call requirePermission — checked below, so a helper cannot be added to
 * the list without actually enforcing permissions.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const APP = join(ROOT, "src", "app");

/** guard name → file that defines it (must reach requirePermission). */
export const GUARDS: Record<string, string | null> = {
  requirePermission: null,
  requireAnyPermission: "src/lib/authz/index.ts",
  hasPermission: "src/lib/authz/index.ts",
  requireSelected: "src/lib/authz/index.ts",
  authorizeEvent: "src/lib/authz/event.ts",
  ledgerAccess: "src/domain/ledger/service.ts",
  requireAdmin: "src/domain/admin/guard.ts",
  resolveCaller: "src/lib/assistant/caller.ts",
  publicRoute: null,
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export type AuditRow = {
  file: string;
  route: string;
  method: string;
  guards: string[];
  permissions: string[];
  publicReason: string | null;
  ok: boolean;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function routePath(file: string): string {
  const rel = relative(APP, file).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
  return "/" + rel.split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/");
}

/** Split a module into exported handlers: name → source text up to the next export. */
function handlers(src: string): { name: string; body: string }[] {
  const re = new RegExp(`export\\s+(?:const\\s+(${METHODS.join("|")})\\s*=|(?:async\\s+)?function\\s+(${METHODS.join("|")})\\b)`, "g");
  const marks: { name: string; at: number }[] = [];
  for (let m; (m = re.exec(src)); ) marks.push({ name: (m[1] ?? m[2])!, at: m.index });
  return marks.map((m, i) => ({ name: m.name, body: src.slice(m.at, marks[i + 1]?.at ?? src.length) }));
}

/** Server actions: "use server" modules — each exported async function. */
function serverActions(src: string): { name: string; body: string }[] {
  if (!/^\s*["']use server["']/m.test(src)) return [];
  const re = /export\s+async\s+function\s+(\w+)/g;
  const marks: { name: string; at: number }[] = [];
  for (let m; (m = re.exec(src)); ) marks.push({ name: m[1]!, at: m.index });
  return marks.map((m, i) => ({ name: m.name, body: src.slice(m.at, marks[i + 1]?.at ?? src.length) }));
}

function guardsIn(body: string): string[] {
  return Object.keys(GUARDS).filter((g) => new RegExp(`\\b${g}\\(`).test(body));
}

/** Literal permission keys passed in this handler, e.g. requirePermission(s, "ledger.read", …). */
function permissionsIn(body: string): string[] {
  const keys = new Set<string>();
  for (const m of body.matchAll(/["'`]([a-z_]+(?:\.[a-z_]+)+)["'`]/g)) if (/^(queue|clock|host|families|event|rsvp|photos|kitchen|ledger|users|roles|weddings|audit|ops|integrations|assistant|jobs|tasks|gifts|thanks|vendors)\./.test(m[1]!)) keys.add(m[1]!);
  return [...keys].sort();
}

export function auditRoutes(): { rows: AuditRow[]; guardProblems: string[] } {
  const guardProblems: string[] = [];
  for (const [name, file] of Object.entries(GUARDS)) {
    if (!file) continue;
    let src = "";
    try {
      src = readFileSync(join(ROOT, file), "utf8");
    } catch {
      guardProblems.push(`${name}: ${file} not found`);
      continue;
    }
    if (!new RegExp(`\\b(export\\s+)?(async\\s+)?function\\s+${name}\\b|\\b${name}\\s*=`).test(src)) guardProblems.push(`${name}: not defined in ${file}`);
    if (!/requirePermission\(|requireAnyPermission\(|hasPermission\(/.test(src)) guardProblems.push(`${name}: ${file} never calls requirePermission`);
  }

  const rows: AuditRow[] = [];
  for (const file of walk(APP)) {
    const src = readFileSync(file, "utf8");
    const isRoute = /\/route\.ts$/.test(file);
    const list = isRoute ? handlers(src) : serverActions(src);
    for (const h of list) {
      const guards = guardsIn(h.body);
      const reason = /publicRoute\(\s*["'`]([^"'`]+)["'`]/.exec(h.body)?.[1] ?? null;
      rows.push({
        file: relative(ROOT, file),
        route: isRoute ? routePath(file) : `action:${relative(APP, file)}#${h.name}`,
        method: isRoute ? h.name : "ACTION",
        guards,
        permissions: permissionsIn(h.body),
        publicReason: reason,
        ok: guards.length > 0 && (!guards.includes("publicRoute") || guards.length > 1 || !!reason),
      });
    }
  }
  rows.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
  return { rows, guardProblems };
}

if (process.argv[1] && /route-audit\.ts$/.test(process.argv[1])) {
  const { rows, guardProblems } = auditRoutes();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rows, guardProblems }, null, 2));
  } else {
    for (const r of rows) {
      const how = r.permissions.length ? r.permissions.join(", ") : r.publicReason ? `public: ${r.publicReason}` : r.guards.join(", ") || "—";
      console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.method.padEnd(6)} ${r.route.padEnd(48)} ${how}`);
    }
    const bad = rows.filter((r) => !r.ok);
    guardProblems.forEach((p) => console.log(`FAIL  guard ${p}`));
    console.log(`\n${rows.length} handlers, ${bad.length} unguarded, ${guardProblems.length} guard problems`);
    if (bad.length || guardProblems.length) process.exit(1);
  }
}
