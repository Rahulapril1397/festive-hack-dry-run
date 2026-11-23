import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { publicSupabaseConfig } from "@/lib/db/auth";
import { quickLoginUsers } from "@/lib/demo/quickLogin";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getSession()) redirect(safeNext);
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold text-rose-800">Staff sign in</h1>
      <LoginForm supabase={publicSupabaseConfig()} next={safeNext} quick={await quickLoginUsers()} />
    </main>
  );
}
