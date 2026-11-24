import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { transportView } from "@/domain/planning/service";
import { fmtDay, fmtHour, fmtWhen, modeLabel } from "@/domain/planning/format";
import { pickupPoint } from "@/domain/planning/calc";
import { DriverForm, VendorLink } from "@/components/shell/PlanActions";

export const dynamic = "force-dynamic";

export default async function TransportPage() {
  const s = await requirePage("planning.read", "/host/transport");
  const [t, canWrite, canVendors] = await Promise.all([transportView(s.weddingId), hasPermission(s, "planning.write"), hasPermission(s, "vendors.manage")]);
  const vendorOptions = t.vendors.map((v) => ({ id: v.id, name: v.name }));
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-3xl font-bold">Transport and pickups</h1>
        <p className="text-stone-600">Guests arriving by train are met at {t.info.stationName ?? "the railway station (set it in Planning settings)"}; by flight, at {t.info.airportName ?? "the airport (set it in Planning settings)"}. Assign a driver and the family sees the name, number and vehicle on its page.</p>
        <p className="mt-1 text-sm text-stone-500" data-testid="coverage">{t.coverage.gaveArrival} of {t.coverage.families} attending families have given an arrival time. Vehicle numbers include a {Math.round(t.info.settings.vehicleBuffer * 100)}% buffer.</p>
      </header>

      {t.slots.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-stone-600" data-testid="no-arrivals">No arrivals yet.</p>
      ) : (
        t.slots.map((sl) => (
          <section key={`${sl.day}${sl.hour}`} className="rounded-2xl border border-amber-200 bg-white p-4" data-testid="slot">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl font-bold text-rose-900">{fmtDay(sl.day)} · {fmtHour(sl.hour)}</h2>
              <p className="text-sm"><b className="text-rose-800">{sl.people}</b> people · {sl.families} families</p>
            </div>
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm" data-testid="recommendation">
              Recommended: {sl.plan.vehicles.map((v) => `${v.count} × ${v.name} (${v.capacity})`).join(" + ") || "none"} — {sl.plan.seats} seats for {sl.plan.seatsNeeded} needed.
            </p>
            <ul className="mt-2 divide-y divide-stone-100 text-sm">
              {sl.items.map((a) => (
                <li key={a.familyId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{a.family}</b> · {a.people} people · {modeLabel(a.mode ?? "not given")}{a.number ? ` ${a.number}` : ""} · {fmtWhen(a.arrivalAt)}
                    <span className="block text-xs text-stone-500">Meet at: {pickupPoint(a.mode, t.info) ?? "own transport / not given"}</span>
                  </span>
                  {canWrite && <DriverForm familyId={a.familyId} current={t.pickups[a.familyId] ?? null} vendors={vendorOptions} />}
                  {!canWrite && t.pickups[a.familyId] && <span className="text-xs">Driver: {t.pickups[a.familyId]!.driverName}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {canVendors && (
        <section>
          <h2 className="mb-1 text-lg font-bold">Transport vendor login</h2>
          <p className="mb-2 text-sm text-stone-600">Link the login a transport vendor signs in with. They then see this arrivals plan under “My bookings”, without guest phone numbers.</p>
          <VendorLink vendors={t.vendors} />
        </section>
      )}
    </main>
  );
}
