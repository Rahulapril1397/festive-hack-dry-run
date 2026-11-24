import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { db } from "@/lib/db/service";
import { publicSupabaseConfig } from "@/lib/db/auth";
import { quickLoginUsers } from "@/lib/demo/quickLogin";
import { DemoBanner } from "./DemoBanner";
import { SideNav } from "./SideNav";
import { RoleSwitcher } from "./RoleSwitcher";
import { WeddingProvider, WeddingSelect } from "./WeddingContext";
import { homeFor, navFor } from "./navConfig";
import { PinkyBua } from "@/components/pinkybua/PinkyBua";
import { staffActive } from "@/lib/assistant/scope";
import { NotificationBell } from "./NotificationBell";

/** Staff chrome: top bar (wedding selector, date, user + role, notifications), role nav, demo banner. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: wedding }, { data: user }, quick] = await Promise.all([
    s.weddingId ? db().from("wedding").select("id, name, is_demo, wedding_date").eq("id", s.weddingId).maybeSingle() : Promise.resolve({ data: null }),
    db().from("app_user").select("email, display_name").eq("id", s.userId).maybeSingle(),
    quickLoginUsers(),
  ]);
  const blocked = s.status !== "active" ? "Your account is suspended. Ask an administrator to reactivate it." : !s.weddingId ? "You have no active role in any wedding yet. Ask an administrator to assign one." : null;

  return (
    <WeddingProvider weddingId={s.weddingId} weddings={s.weddings}>
      <div className="flex min-h-dvh flex-col">
        <DemoBanner show={!!wedding?.is_demo} />
        <div className="toran" aria-hidden />
        <header className="gold-rule flex flex-wrap items-center justify-between gap-3 bg-rose-800 px-4 py-2 text-amber-50">
          <div className="flex items-center gap-3">
            <Link href={homeFor(s.role, s.permissions)} className="font-display text-2xl font-bold tracking-wide text-amber-200">
              🪔 Pehle Aap <span lang="hi" className="ml-1 text-lg font-semibold text-amber-100/90">पहले आप</span>
            </Link>
            <WeddingSelect />
            {wedding?.wedding_date && <span className="hidden text-sm text-amber-100/80 sm:inline">{new Date(wedding.wedding_date).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {!blocked && <NotificationBell />}
            <span className="hidden text-amber-100 sm:inline">{user?.display_name ?? user?.email}</span>
            <span className="rounded bg-amber-200 px-2 py-0.5 font-semibold text-rose-900" data-testid="current-role">
              {s.role || "no role"}
            </span>
            {quick && <RoleSwitcher supabase={publicSupabaseConfig()} users={quick.users} currentEmail={user?.email ?? null} password={quick.password} />}
            <form action="/api/auth/logout" method="post">
              <button className="underline decoration-amber-300 underline-offset-2">Sign out</button>
            </form>
          </div>
        </header>
        <div className="flex flex-1 flex-col md:flex-row">
          <aside className="border-b border-stone-200 bg-amber-50/70 md:w-56 md:border-b-0 md:border-r">
            <SideNav items={navFor(s.permissions)} />
          </aside>
          <div className="min-w-0 flex-1">
            {blocked ? (
              <main className="p-6" data-testid="access-denied">
                <h1 className="text-2xl font-bold">No access</h1>
                <p className="mt-2 text-stone-600">{blocked}</p>
              </main>
            ) : (
              children
            )}
          </div>
        </div>
        {!blocked && <PinkyBua mode="staff" inactive={!staffActive(s)} />}
      </div>
    </WeddingProvider>
  );
}
