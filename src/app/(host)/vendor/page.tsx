import { requirePage } from "@/components/shell/guard";
import { vendorPortal } from "@/domain/planning/service";
import { fmtDay, fmtHour, fmtWhen, modeLabel } from "@/domain/planning/format";

export const dynamic = "force-dynamic";

/** A vendor's own page: its bookings, tasks, plates for its functions and, for transport, the arrivals plan. */
export default async function VendorPortalPage() {
  const s = await requirePage("vendor.portal", "/vendor");
  const v = await vendorPortal(s.userId, s.weddingId);
  if (!v) {
    return (
      <main className="p-6" data-testid="vendor-unlinked">
        <h1 className="text-2xl font-bold">My bookings</h1>
        <p className="mt-2 text-stone-600">Your login is not linked to a vendor yet. Ask the wedding admin to link it.</p>
      </main>
    );
  }
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-3xl font-bold">{v.vendor.name}</h1>
        <p className="text-stone-600">{v.vendor.category}{v.vendor.services ? ` · ${v.vendor.services}` : ""}</p>
      </header>

      <section>
        <h2 className="mb-2 text-xl font-bold">Your functions</h2>
        {v.bookings.length === 0 ? <p className="text-stone-600">You are not booked for any function yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2" data-testid="bookings">
            {v.bookings.map((b) => (
              <article key={b.eventId} className="rounded-2xl border border-amber-200 bg-white p-4">
                <h3 className="font-display text-2xl font-bold text-rose-900">{b.name}</h3>
                <p className="text-sm text-stone-500">{fmtWhen(b.startsAt)}</p>
                {b.scope && <p className="mt-1 text-sm">{b.scope}</p>}
                {b.arriveAt && <p className="text-sm text-stone-600">Please arrive by {fmtWhen(b.arriveAt)}</p>}
                <p className="mt-2 text-sm"><b className="text-rose-800">{b.plates}</b> plates planned</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xl font-bold">Your tasks</h2>
        {v.tasks.length === 0 ? <p className="text-stone-600">No open tasks.</p> : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-amber-200 bg-white text-sm" data-testid="vendor-tasks">
            {v.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span>{t.title}{t.event && <span className="text-stone-500"> · {t.event}</span>}</span>
                <span className="text-xs text-stone-500">{[t.priority !== "normal" && t.priority, t.dueAt && `due ${fmtWhen(t.dueAt)}`, t.status.replace("_", " ")].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {v.transport && (
        <section data-testid="driver-plan">
          <h2 className="mb-1 text-xl font-bold">Arrivals to plan for</h2>
          <p className="mb-2 text-sm text-stone-600">Who is arriving and when, so you can plan vehicles. {v.transport.coverage.gaveArrival} families have given arrival details so far; the numbers grow as more do.</p>
          {v.transport.slots.length === 0 ? <p className="text-stone-600">No arrivals yet.</p> : v.transport.slots.map((sl) => (
            <div key={`${sl.day}${sl.hour}`} className="mb-3 rounded-2xl border border-amber-200 bg-white p-4" data-testid="slot">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-xl font-bold text-rose-900">{fmtDay(sl.day)} · {fmtHour(sl.hour)}</h3>
                <p className="text-sm"><b className="text-rose-800">{sl.people}</b> people</p>
              </div>
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm">Recommended: {sl.plan.vehicles.map((x) => `${x.count} × ${x.name} (${x.capacity})`).join(" + ")} for {sl.plan.seatsNeeded} seats.</p>
              <ul className="mt-2 text-sm">
                {sl.arrivals.map((a, i) => <li key={i} className="border-b border-stone-100 py-1">{a.family} · {a.people} people · {modeLabel(a.mode ?? "not given")}{a.number ? ` ${a.number}` : ""} · {fmtWhen(a.at)} · meet at {a.point ?? "own transport"}</li>)}
              </ul>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
