import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { authClient } from "@/lib/db/auth";
import { rpc, db } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { applyOverrides } from "@/lib/flags/overrides";
import { primaryRole, type Permission, type Role } from "./catalogue";

export const WEDDING_COOKIE = "pa_wedding";

export type WeddingAccess = { id: string; name: string; isDemo: boolean; roles: string[] };

/**
 * The signed-in staff member. `role` / `weddingId` keep the Stage 1 shape (C1); `permissions`
 * are for the selected wedding and come from Postgres. A suspended user still gets a Session
 * (status "suspended", no permissions) so every protected call answers 403, not 401.
 */
export type Session = {
  userId: string;
  email: string | null;
  role: Role;
  weddingId: string;
  roles: string[];
  permissions: ReadonlySet<string>;
  isSuperAdmin: boolean;
  status: "active" | "suspended";
  weddings: WeddingAccess[];
};

type Ctx = {
  status: "active" | "suspended";
  isSuperAdmin: boolean;
  weddings: WeddingAccess[];
  weddingId: string | null;
  roles: string[];
  permissions: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One Supabase JWT check + one Postgres call per request (memoised for the request). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await authClient();
  const { data, error } = await supabase.auth.getUser(); // verifies the JWT with Supabase
  if (error || !data.user) return null;
  const selected = (await cookies()).get(WEDDING_COOKIE)?.value;
  const ctx = await rpc<Ctx | null>("authz_context", { p_user: data.user.id, p_wedding: selected && UUID.test(selected) ? selected : null });
  if (!ctx) return null; // auth user without an app_user row: not staff
  touchLastSeen(data.user.id);
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    role: primaryRole(ctx.roles),
    weddingId: ctx.weddingId ?? "",
    roles: ctx.roles,
    permissions: new Set(ctx.status === "active" ? ctx.permissions : []),
    isSuperAdmin: ctx.isSuperAdmin,
    status: ctx.status,
    weddings: ctx.weddings,
  };
});

/** Permissions + roles of a user in some other wedding than the selected one (memoised). */
const permissionsIn = cache(async (userId: string, weddingId: string) => {
  const r = await rpc<{ permissions: string[]; roles: string[] }>("authz_permissions", { p_user: userId, p_wedding: weddingId });
  return { permissions: new Set(r.permissions), roles: r.roles };
});

async function accessIn(ctx: Session, weddingId: string) {
  if (weddingId === ctx.weddingId) return { permissions: ctx.permissions, role: ctx.role };
  if (!UUID.test(weddingId)) return { permissions: new Set<string>(), role: "" };
  const r = await permissionsIn(ctx.userId, weddingId);
  return { permissions: r.permissions, role: primaryRole(r.roles) };
}

/**
 * FROZEN SIGNATURE (contract C1). Throws AppError UNAUTHENTICATED (401) or FORBIDDEN (403).
 * Stage 2: Postgres (authz.effective_permissions: active user, assignment window, role
 * permission, wedding match, wedding-less super_admin), then E2's grant-only Flagsmith overrides.
 */
export async function requirePermission(ctx: Session | null, key: Permission, weddingId: string): Promise<Session> {
  if (!ctx) throw new AppError("UNAUTHENTICATED");
  if (ctx.status !== "active") throw new AppError("FORBIDDEN", "Account suspended");
  const { permissions, role } = await accessIn(ctx, weddingId);
  const base = permissions.has(key);
  const allowed = role ? await applyOverrides({ userId: ctx.userId, role, weddingId }, key, base, { onEval: logFlagEval }) : base;
  if (!allowed) throw new AppError("FORBIDDEN");
  return ctx;
}

/** Passes if the caller holds at least one of the keys (each checked through requirePermission). */
export async function requireAnyPermission(ctx: Session | null, keys: readonly Permission[], weddingId: string): Promise<Session> {
  let last: unknown = new AppError("FORBIDDEN");
  for (const k of keys) {
    try {
      return await requirePermission(ctx, k, weddingId);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Same decision as requirePermission, as a boolean (for showing/hiding UI). */
export async function hasPermission(ctx: Session | null, key: Permission, weddingId?: string): Promise<boolean> {
  if (!ctx) return false;
  try {
    await requirePermission(ctx, key, weddingId ?? ctx.weddingId);
    return true;
  } catch {
    return false;
  }
}

/** Fire-and-forget: Flagsmith override evaluations are persisted (E2, feature_flag_eval_log). */
function logFlagEval(e: { weddingId: string; role: string; flag: string; permission: string; result: boolean; fallback: boolean }) {
  void db()
    .from("feature_flag_eval_log")
    .insert({ wedding_id: UUID.test(e.weddingId) ? e.weddingId : null, role: e.role, flag: e.flag, permission: e.permission, result: e.result, fallback: e.fallback })
    .then(({ error }) => error && console.warn(JSON.stringify({ severity: "WARNING", message: "flag eval log failed", code: error.code })));
}

const seen = new Map<string, number>();
function touchLastSeen(userId: string) {
  const now = Date.now();
  if ((seen.get(userId) ?? 0) > now - 5 * 60_000) return; // at most every 5 minutes per pod
  seen.set(userId, now);
  void db().from("app_user").update({ last_seen_at: new Date(now).toISOString() }).eq("id", userId).then(() => {});
}

export type { Permission, Role } from "./catalogue";
