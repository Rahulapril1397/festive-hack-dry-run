import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { ROLES } from "@/lib/authz/staticMap";
import { db } from "@/lib/db/service";
import { publicSupabaseConfig } from "@/lib/db/auth";
import { isProduction } from "@/lib/env";
import { DemoBanner } from "./DemoBanner";
import { SideNav } from "./SideNav";
import { RoleSwitcher } from "./RoleSwitcher";
import { homeFor, navFor } from "./navConfig";

/** Staff chrome: top bar (wedding, date, user + role, notifications), role nav, demo banner. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: wedding }, { data: user }] = await Promise.all([
    db().from("wedding").select("id, name, is_demo, wedding_date").eq("id", s.weddingId).single(),
    db().from("app_user").select("email, display_name").eq("id", s.userId).maybeSingle(),
  ]);
  const quick = isProduction() ? null : { password: process.env.SEED_USER_PASSWORD ?? "", domain: "demo.pehleaap.test" };

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner show={!!wedding?.is_demo} />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href={homeFor(s.role)} className="font-bold text-rose-800">
            Pehle Aap
          </Link>
          <select className="rounded border border-stone-300 bg-white px-2 py-0.5 text-sm" aria-label="Wedding" defaultValue={wedding?.id}>
            <option value={wedding?.id}>{wedding?.name}</option>
          </select>
          {wedding?.wedding_date && <span className="hidden text-sm text-stone-500 sm:inline">{new Date(wedding.wedding_date).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span title="Notifications — coming soon" className="cursor-default text-stone-400" aria-label="Notifications (coming soon)">
            🔔
          </span>
          <span className="hidden text-stone-600 sm:inline">{user?.display_name ?? user?.email}</span>
          <span className="rounded bg-stone-100 px-2 py-0.5" data-testid="current-role">
            {s.role}
          </span>
          {quick && <RoleSwitcher supabase={publicSupabaseConfig()} roles={[...ROLES]} current={s.role} {...quick} />}
          <form action="/api/auth/logout" method="post">
            <button className="underline">Sign out</button>
          </form>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-stone-200 bg-white md:w-56 md:border-b-0 md:border-r">
          <SideNav items={navFor(s.role)} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
