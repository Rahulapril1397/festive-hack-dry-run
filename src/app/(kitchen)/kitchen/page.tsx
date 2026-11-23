import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { db } from "@/lib/db/service";
import { MealStatusButtons } from "./MealStatusButtons";

export const dynamic = "force-dynamic";

/** Per-function plates and arrivals. Deliberately no phones, shagun or private notes. */
export default async function KitchenPage() {
  const s = await requirePage("kitchen.read", "/kitchen");
  const [{ data }, canWrite] = await Promise.all([
    db().from("v_event_plates").select("event_id, name, starts_at, planned_plates, attending_families, arrived_families, arrived_guests_est, meal_status").eq("wedding_id", s.weddingId).order("starts_at"),
    hasPermission(s, "kitchen.write"),
  ]);
  const rows = data ?? [];
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Kitchen</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {rows.map((r) => (
          <section key={r.event_id} className="rounded-xl border border-stone-200 bg-white p-4" data-testid={`kitchen-${r.name}`}>
            <h2 className="text-lg font-semibold">{r.name}</h2>
            <p className="text-sm text-stone-500">{r.starts_at ? new Date(r.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : ""}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Planned plates" value={r.planned_plates} />
              <Stat label="Attending families" value={r.attending_families} />
              <Stat label="Arrived families" value={r.arrived_families} />
              <Stat label="Arrived guests (est.)" value={r.arrived_guests_est} />
            </dl>
            <p className="mt-3 text-sm">
              Meal: <b>{r.meal_status.replace("_", " ")}</b>
            </p>
            {canWrite && <MealStatusButtons eventId={r.event_id} current={r.meal_status} />}
          </section>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-stone-50 p-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="text-xl font-bold">{value}</dd>
    </div>
  );
}
