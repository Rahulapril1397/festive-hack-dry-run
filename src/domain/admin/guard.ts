import "server-only";
import { getSession, requirePermission, type Permission, type Session } from "@/lib/authz";
import { AppError } from "@/lib/errors";

/** Admin routes: signed in + `key` in the given wedding (default: the selected wedding). */
export async function requireAdmin(key: Permission, weddingId?: string | null): Promise<Session> {
  const s = await getSession();
  return requirePermission(s, key, weddingId ?? s?.weddingId ?? "");
}

export function requireSuperAdmin(s: Session) {
  if (!s.isSuperAdmin) throw new AppError("FORBIDDEN", "Super admin only");
}
