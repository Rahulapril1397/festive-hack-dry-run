import "server-only";
import { redirect } from "next/navigation";
import { getSession, hasPermission, type Permission, type Session } from "@/lib/authz";

/** Server-side page guard: not signed in → /login; lacking permission → /denied. */
export async function requirePage(key: Permission, next: string): Promise<Session> {
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!(await hasPermission(s, key))) redirect(`/denied?need=${encodeURIComponent(key)}`);
  return s;
}

/** Like requirePage, but any one of `keys` is enough (used by the static demo tiles). */
export async function requireAnyPage(keys: readonly Permission[], next: string): Promise<Session> {
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  for (const k of keys) if (await hasPermission(s, k)) return s;
  redirect(`/denied?need=${encodeURIComponent(keys[0] ?? "")}`);
}
