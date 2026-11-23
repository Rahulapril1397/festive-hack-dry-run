import "server-only";
import { cache } from "react";
import { authClient } from "@/lib/db/auth";
import { rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { applyOverrides } from "@/lib/flags/overrides";
import { roleHas, type Permission, type Role } from "./staticMap";

export type Session = { userId: string; role: Role; weddingId: string };

/** Signed-in staff member with a role, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await authClient();
  const { data, error } = await supabase.auth.getUser(); // verifies the JWT with Supabase
  if (error || !data.user) return null;
  const rows = await rpc<{ role_key: Role; wedding_id: string }[]>("session_role", { p_user: data.user.id });
  const row = rows[0];
  if (!row) return null;
  return { userId: data.user.id, role: row.role_key, weddingId: row.wedding_id };
});

/**
 * FROZEN SIGNATURE (contract C1). Throws AppError UNAUTHENTICATED (401) or FORBIDDEN (403).
 * Stage 1: static map, then E2's allowlisted Flagsmith overrides (grant-only, fail-safe).
 * Stage 2: same signature, backed by role_permission in Postgres.
 */
export async function requirePermission(
  ctx: Session | null,
  key: Permission,
  weddingId: string,
): Promise<Session> {
  if (!ctx) throw new AppError("UNAUTHENTICATED");
  if (ctx.weddingId !== weddingId) throw new AppError("FORBIDDEN");
  const allowed = await applyOverrides(ctx, key, roleHas(ctx.role, key));
  if (!allowed) throw new AppError("FORBIDDEN");
  return ctx;
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

export type { Permission, Role } from "./staticMap";
