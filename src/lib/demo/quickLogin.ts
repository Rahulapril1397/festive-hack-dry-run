import "server-only";
import { db } from "@/lib/db/service";
import { isProduction } from "@/lib/env";

/** Non-production only: the seeded demo staff (read from the database, not hard-coded). */
export const DEMO_EMAIL_DOMAIN = "demo.pehleaap.test";

export async function quickLoginUsers(): Promise<{ users: { email: string; label: string }[]; password: string } | null> {
  if (isProduction()) return null;
  const password = process.env.SEED_USER_PASSWORD ?? "";
  if (!password) return null;
  const { data } = await db().from("app_user").select("email").ilike("email", `%@${DEMO_EMAIL_DOMAIN}`).order("email");
  const users = (data ?? []).map((u) => ({ email: u.email as string, label: (u.email as string).split("@")[0]! }));
  return users.length ? { users, password } : null;
}
