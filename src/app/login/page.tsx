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
    <main className="mx-auto mt-10 max-w-sm overflow-hidden rounded-2xl border border-amber-300 bg-white/90 shadow-md">
      <div className="toran" aria-hidden />
      <div className="p-8">
      <p className="text-center text-3xl" aria-hidden>🪔</p>
      <h1 className="mb-1 text-center text-4xl font-bold text-rose-800">Pehle Aap</h1>
      <p className="mb-6 text-center text-sm tracking-widest text-amber-700">STAFF SIGN IN · <span lang="hi">स्वागतम्</span></p>
      <LoginForm supabase={publicSupabaseConfig()} next={safeNext} quick={await quickLoginUsers()} />
      </div>
    </main>
  );
}
