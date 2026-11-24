import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { overview } from "@/domain/host/queries";
import { PostForm } from "@/components/shell/PostForm";
import { vendorsByEvent } from "@/domain/vendors/service";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FunctionsPage() {
  const s = await requirePage("host.read", "/host/functions");
  const [{ functions }, canCreate, vendors] = await Promise.all([overview(s), hasPermission(s, "event.write"), vendorsByEvent(s)]);
  return (
    <main className="grid gap-6 p-4 md:grid-cols-[1fr_20rem] md:p-6">
      <section>
        <h1 className="mb-4 text-2xl font-bold">Functions</h1>
        <ul className="flex flex-col gap-2">
          {functions.map((f) => (
            <li key={f.eventId} className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="font-semibold">{f.name}</p>
              <p className="text-sm text-stone-500">{f.startsAt ? new Date(f.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "No time set"}</p>
              <p className="mt-1 text-sm">
                {f.yes} attending · {f.plannedPlates} plates · {f.checkedIn} checked in
              </p>
              {(vendors.get(f.eventId) ?? []).length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1" data-testid="function-vendors">
                  {vendors.get(f.eventId)!.map((v) => (
                    <li key={v.id}>
                      <Link href={`/vendors/${v.id}`} className="inline-block rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-900 hover:underline" title={v.scope ?? undefined}>
                        {v.category}: {v.name}
                        {v.arrivalAt && ` · ${new Date(v.arrivalAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
      {canCreate && (
        <aside>
          <h2 className="mb-2 font-semibold">Create function</h2>
          <PostForm
            url="/api/host/event"
            testid="create-function"
            submit="Create function"
            fields={[
              { name: "name", label: "Name (e.g. Mehendi)", required: true },
              { name: "startsAt", label: "Starts", type: "datetime-local" },
              { name: "language", label: "TV language", options: [{ value: "en", label: "TV: English" }, { value: "hi", label: "TV: Hindi" }] },
            ]}
          />
        </aside>
      )}
    </main>
  );
}
