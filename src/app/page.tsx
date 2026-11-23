import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { homeFor } from "@/components/shell/navConfig";

export const dynamic = "force-dynamic";

export default async function Home() {
  const s = await getSession().catch(() => null);
  if (s) redirect(homeFor(s.role, s.permissions));
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-3xl font-bold text-rose-800">Pehle Aap</h1>
      <p className="text-stone-600">Guests: scan the QR at the venue to check in, or open the link your family received.</p>
      <Link className="btn-primary" href="/login">
        Staff sign in
      </Link>
    </main>
  );
}
