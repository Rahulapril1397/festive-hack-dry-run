import Link from "next/link";
import { requirePage } from "@/components/shell/guard";
import { overview } from "@/domain/host/queries";
import { AutoRefresh } from "@/components/shell/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function HostOverview() {
  const s = await requirePage("host.read", "/host");
  const o = await overview(s);
  const k = o.kpis;
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <AutoRefresh ms={5000} />
      <h1 className="text-2xl font-bold">Overview</h1>
      {o.functions.length === 0 && (
        <div className="rounded-xl border border-dashed bg-white p-6 text-center" data-testid="overview-empty">
          <p className="font-semibold">No functions yet.</p>
          <p className="text-sm text-stone-600">Create the first function under Functions, then import families under Families and RSVP.</p>
        </div>
      )}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="kpis">
        <Kpi label="RSVP yes (all functions)" value={k.rsvpYes} />
        <Kpi label="Expected plates" value={k.expectedPlates} />
        <Kpi label="Checked-in families" value={k.checkedIn} testid="kpi-checked-in" />
        <Kpi label="Queue waiting" value={k.queueWaiting} />
        <Kpi label="Ledger entries" value={k.ledgerEntries} />
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Function attendance</h2>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left">
              <tr>
                {["Function", "Invited", "Yes", "No", "Pending", "Plates", "Checked in", "Waiting", "Now on stage", "Queue", "Meal"].map((h) => (
                  <th key={h} className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {o.functions.map((f) => (
                <tr key={f.eventId} className="border-t">
                  <td className="p-2 font-medium">
                    <Link className="underline" href={`/stage/${f.eventId}`}>
                      {f.name}
                    </Link>
                  </td>
                  <td className="p-2">{f.invited}</td>
                  <td className="p-2">{f.yes}</td>
                  <td className="p-2">{f.no}</td>
                  <td className="p-2">{f.pending}</td>
                  <td className="p-2">{f.plannedPlates}</td>
                  <td className="p-2">{f.checkedIn}</td>
                  <td className="p-2">{f.waiting}</td>
                  <td className="p-2">{f.nowServing ?? "—"}</td>
                  <td className="p-2">{f.paused ? <span className="text-amber-700">paused</span> : "running"}</td>
                  <td className="p-2">{f.mealStatus.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">Recent stage calls</h2>
          <ul className="divide-y rounded-lg border border-stone-200 bg-white text-sm">
            {o.recentCalls.length === 0 && <li className="p-3 text-stone-500">None yet.</li>}
            {o.recentCalls.map((c) => (
              <li key={c.id} className="flex justify-between p-2">
                <span>
                  {c.event} · {c.action.replace("_", " ")} {c.token ? `#${c.token}` : ""}
                </span>
                <span className="text-stone-500">{new Date(c.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">Exceptions</h2>
          <ul className="divide-y rounded-lg border border-stone-200 bg-white text-sm" data-testid="exceptions">
            {o.exceptions.length === 0 && <li className="p-3 text-stone-500">Nothing needs attention.</li>}
            {o.exceptions.map((x, i) => (
              <li key={i} className="p-2">
                {x}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Kpi({ label, value, testid }: { label: string; value: number; testid?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-2xl font-bold" data-testid={testid}>
        {value}
      </p>
    </div>
  );
}
