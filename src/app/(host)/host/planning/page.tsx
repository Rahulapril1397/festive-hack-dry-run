import Link from "next/link";
import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { planningOverview } from "@/domain/planning/service";
import { fmtDay, fmtWhen, foodLabel, modeLabel } from "@/domain/planning/format";
import { SettingsForm } from "@/components/shell/PlanActions";

export const dynamic = "force-dynamic";

const Stat = ({ label, value, sub, testid }: { label: string; value: React.ReactNode; sub?: string; testid?: string }) => (
  <div className="rounded-xl border border-amber-200 bg-white p-4" data-testid={testid}>
    <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
    <p className="font-display text-3xl font-bold text-rose-800">{value}</p>
    {sub && <p className="text-xs text-stone-500">{sub}</p>}
  </div>
);

export default async function PlanningPage() {
  const s = await requirePage("planning.read", "/host/planning");
  const [p, canWrite] = await Promise.all([planningOverview(s.weddingId), hasPermission(s, "planning.write")]);
  const { housekeeping: h, rooms, coverage } = p;
  return (
    <main className="flex flex-col gap-8 p-4 md:p-6">
      <header>
        <h1 className="text-3xl font-bold">Planning</h1>
        <p className="text-stone-600">
          {p.info.venueName ? `${p.info.venueName}${p.info.venueCity ? `, ${p.info.venueCity}` : ""}` : "Set the venue under Settings below."} Numbers update as guests fill in their travel and food details.
        </p>
        <p className="mt-1 text-sm text-stone-500" data-testid="coverage">
          {coverage.gaveArrival} of {coverage.families} attending families have given arrival details; {coverage.gaveFood} have given a food preference.
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-xl font-bold">Arrivals by day</h2>
        {p.days.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-stone-600" data-testid="no-arrivals">No arrival details yet. They appear here as guests fill in “Your journey and your plate”.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
            <table className="w-full text-sm" data-testid="arrivals-days">
              <thead className="bg-amber-50 text-left"><tr><th className="p-2">Day</th><th className="p-2">People</th><th className="p-2">Families</th><th className="p-2">How they travel</th></tr></thead>
              <tbody>
                {p.days.map((d) => (
                  <tr key={d.day} className="border-t">
                    <td className="p-2 font-medium">{fmtDay(d.day)}</td>
                    <td className="p-2 font-bold text-rose-800">{d.people}</td>
                    <td className="p-2">{d.families}</td>
                    <td className="p-2 text-stone-600">{Object.entries(d.byMode).map(([m, n]) => `${modeLabel(m)} ${n}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm"><Link href="/host/transport" className="text-rose-800 underline">Hour-by-hour pickups and drivers →</Link></p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-bold">Rooms, mattresses and housekeeping</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="housekeeping">
          <Stat label="Rooms allocated" value={`${rooms.allocated} of ${rooms.total}`} sub={rooms.short > 0 ? `${rooms.short} more rooms needed` : `${rooms.free} free · ${rooms.needed} needed`} testid="stat-rooms" />
          <Stat label="Extra mattresses" value={h.mattresses} sub={`after ${p.info.settings.bedsPerRoom} beds per room`} />
          <Stat label="Cleaners" value={h.cleaners} sub={`1 per ${p.info.settings.roomsPerCleaner} rooms`} />
          <Stat label="Tea and water staff" value={h.teaWater} sub={`1 per ${p.info.settings.guestsPerTeaStaff} guests, busiest function`} />
        </div>
        <p className="mt-2 text-sm"><Link href="/host/rooms" className="text-rose-800 underline">Rooms and allocation →</Link> <span className="text-stone-500">Recommendations use the ratios in Settings; change them to match your venue.</span></p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-bold">Function by function</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {p.functions.map((f) => (
            <article key={f.eventId} className="rounded-2xl border border-amber-200 bg-white p-4" data-testid={`plan-${f.name}`}>
              <h3 className="font-display text-2xl font-bold text-rose-900">{f.name}</h3>
              <p className="text-sm text-stone-500">{fmtWhen(f.startsAt)}</p>
              <p className="mt-2"><span className="text-2xl font-bold text-rose-800">{f.people}</span> people from {f.attendingFamilies} families · <b>{f.plates}</b> plates</p>
              <p className="mt-1 text-sm text-stone-600" data-testid="food-split">
                {Object.entries(f.food).filter(([, n]) => n > 0).map(([k, n]) => `${foodLabel(k)} ${n}`).join(" · ") || "No food preferences yet"}
              </p>
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Vendors</p>
                {f.vendors.length === 0 ? <p className="text-sm text-stone-500">None booked yet.</p> : (
                  <ul className="flex flex-wrap gap-1">{f.vendors.map((v) => <li key={v.id} className="rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-900" title={v.scope ?? undefined}>{v.category}: {v.name}</li>)}</ul>
                )}
              </div>
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Open tasks</p>
                {f.tasks.length === 0 ? <p className="text-sm text-stone-500">No open tasks for this function.</p> : (
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {f.tasks.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-stone-100 pb-1">
                        <span>{t.title}{t.priority !== "normal" && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-800">{t.priority}</span>}</span>
                        <span className="text-xs text-stone-500">{[t.owner && `owner ${t.owner}`, t.vendor && `vendor ${t.vendor}`, t.dueAt && `due ${fmtWhen(t.dueAt)}`, t.status.replace("_", " ")].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {canWrite && (
        <section>
          <h2 className="mb-2 text-xl font-bold">Settings</h2>
          <SettingsForm initial={{ venueName: p.info.venueName ?? "", venueCity: p.info.venueCity ?? "", stationName: p.info.stationName ?? "", airportName: p.info.airportName ?? "", ...p.info.settings }} />
        </section>
      )}
    </main>
  );
}
