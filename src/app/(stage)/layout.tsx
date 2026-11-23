import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/authz";
import { db } from "@/lib/db/service";
import { DemoBanner } from "@/components/DemoBanner";

export const dynamic = "force-dynamic";

export default async function StageLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { data: wedding } = await db().from("wedding").select("name, is_demo").eq("id", session.weddingId).single();

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner show={!!wedding?.is_demo} />
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-2">
        <Link href="/stage" className="font-bold text-rose-800">
          Pehle Aap · {wedding?.name}
        </Link>
        <form action="/api/auth/logout" method="post" className="flex items-center gap-3 text-sm">
          <span className="rounded bg-stone-100 px-2 py-0.5">{session.role}</span>
          <button className="underline">Sign out</button>
        </form>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
