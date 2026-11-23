import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { familiesWithRsvp } from "@/domain/host/queries";
import { AddFamilyForm } from "./AddFamilyForm";

export const dynamic = "force-dynamic";

const CELL: Record<string, string> = { yes: "bg-green-100 text-green-900", no: "bg-stone-200 text-stone-600", pending: "text-stone-400" };

export default async function FamiliesPage() {
  const s = await requirePage("family.read", "/host/families");
  const [{ events, families }, canWrite] = await Promise.all([familiesWithRsvp(s), hasPermission(s, "family.write")]);
  return (
    <main className="grid gap-6 p-4 md:p-6 xl:grid-cols-[1fr_20rem]">
      <section className="min-w-0">
        <h1 className="mb-4 text-2xl font-bold">Families and RSVP ({families.length})</h1>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left">
              <tr>
                <th className="p-2">Family</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Lang</th>
                <th className="p-2">Token</th>
                {events.map((e) => (
                  <th key={e.id} className="p-2">
                    {e.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="p-2">
                    {f.name}
                    {f.isWalkIn && <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">walk-in</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">{f.phoneLast4 ? `••••${f.phoneLast4}` : "—"}</td>
                  <td className="p-2">{f.language}</td>
                  <td className="p-2">{f.token ?? "—"}</td>
                  {events.map((e) => {
                    const r = f.rsvp[e.id];
                    return (
                      <td key={e.id} className={`p-2 ${CELL[r?.status ?? "pending"]}`}>
                        {r?.status === "yes" ? `yes · ${r.headcount}` : (r?.status ?? "pending")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {canWrite && (
        <aside>
          <h2 className="mb-2 font-semibold">Add family</h2>
          <AddFamilyForm />
        </aside>
      )}
    </main>
  );
}
