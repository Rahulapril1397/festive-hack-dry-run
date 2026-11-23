import "server-only";
import { cache } from "react";
import { authClient } from "@/lib/db/auth";
import { rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
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
 * Stage 1: static map. Stage 2: same signature, backed by role_permission in Postgres.
 */
export async function requirePermission(
  ctx: Session | null,
  key: Permission,
  weddingId: string,
): Promise<Session> {
  if (!ctx) throw new AppError("UNAUTHENTICATED");
  if (ctx.weddingId !== weddingId || !roleHas(ctx.role, key)) throw new AppError("FORBIDDEN");
  return ctx;
}

export type { Permission, Role } from "./staticMap";
