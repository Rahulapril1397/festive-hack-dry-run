import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { familiesWithRsvp } from "@/domain/host/queries";
import { AddFamilyForm } from "./AddFamilyForm";
import { FamiliesTable } from "./FamiliesTable";
import { ImportFamilies } from "./ImportFamilies";

export const dynamic = "force-dynamic";

export default async function FamiliesPage() {
  const s = await requirePage("families.read", "/host/families");
  const [canWrite, canRsvp] = await Promise.all([hasPermission(s, "families.write"), hasPermission(s, "rsvp.manage")]);
  const { events, families } = await familiesWithRsvp(s, canWrite);
  return (
    <main className="grid gap-6 p-4 md:p-6 xl:grid-cols-[1fr_20rem]">
      <section className="min-w-0">
        <h1 className="mb-4 text-2xl font-bold">Families and RSVP ({families.length})</h1>
        {families.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center" data-testid="families-empty">
            <p className="font-semibold">No families yet.</p>
            <p className="text-sm text-stone-600">{canWrite ? "Import a CSV (name, phone, language, headcount_max) or add a family on the right." : "Ask the host to import the guest list."}</p>
          </div>
        ) : (
          <FamiliesTable events={events} families={families} can={{ write: canWrite, rsvp: canRsvp }} />
        )}
      </section>
      {canWrite && (
        <aside className="flex flex-col gap-6">
          <div>
            <h2 className="mb-2 font-semibold">Import CSV</h2>
            <ImportFamilies />
          </div>
          <div>
            <h2 className="mb-2 font-semibold">Add family</h2>
            <AddFamilyForm />
          </div>
        </aside>
      )}
    </main>
  );
}
