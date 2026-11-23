import "server-only";
import { db } from "@/lib/db/service";

export type NotificationItem = { id: string; title: string; body: string; link: string | null; kind: string | null; createdAt: string; read: boolean };

export async function listNotifications(userId: string, weddingId: string): Promise<{ items: NotificationItem[]; unread: number }> {
  if (!weddingId) return { items: [], unread: 0 };
  const [{ data, error }, { count }] = await Promise.all([
    db().from("notification").select("id, title, body, link, kind, created_at, read_at").eq("user_id", userId).eq("wedding_id", weddingId).order("created_at", { ascending: false }).limit(30),
    db().from("notification").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("wedding_id", weddingId).is("read_at", null),
  ]);
  if (error) throw new Error(error.message);
  return {
    unread: count ?? 0,
    items: (data ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, link: safeLink(n.link), kind: n.kind, createdAt: n.created_at, read: !!n.read_at })),
  };
}

export async function markRead(userId: string, weddingId: string, ids?: string[]): Promise<number> {
  let q = db().from("notification").update({ read_at: new Date().toISOString() }, { count: "exact" }).eq("user_id", userId).eq("wedding_id", weddingId).is("read_at", null);
  if (ids?.length) q = q.in("id", ids);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Only same-site relative links are rendered. */
export const safeLink = (l: string | null) => (l && l.startsWith("/") && !l.startsWith("//") ? l : null);
