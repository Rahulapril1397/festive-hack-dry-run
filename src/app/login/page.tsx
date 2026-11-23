import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { publicSupabaseConfig } from "@/lib/db/auth";
import { isProduction } from "@/lib/env";
import { ROLES } from "@/lib/authz/staticMap";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getSession()) redirect(safeNext);

  // Quick-login is a non-prod convenience for the seeded demo users (scripts/seed.ts).
  const quick = isProduction()
    ? null
    : { roles: [...ROLES], password: process.env.SEED_USER_PASSWORD ?? "", domain: "demo.pehleaap.test" };

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold text-rose-800">Staff sign in</h1>
      <LoginForm supabase={publicSupabaseConfig()} next={safeNext} quick={quick} />
    </main>
  );
}
