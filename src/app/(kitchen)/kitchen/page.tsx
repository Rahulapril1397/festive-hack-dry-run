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
  const { data: ms } = rows.length ? await db().from("meal_status").select("event_id, updated_at, user:updated_by(display_name, email)").in("event_id", rows.map((r) => r.event_id)) : { data: [] };
  const updatedBy = new Map((ms ?? []).map((m) => {
    const u = m.user as unknown as { display_name: string | null; email: string } | null;
    return [m.event_id as string, { who: u?.display_name ?? u?.email?.split("@")[0] ?? "someone", at: m.updated_at as string }];
  }));
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Kitchen</h1>
      {rows.length === 0 && <p className="text-stone-500" data-testid="kitchen-empty">No functions yet. Counts appear once the host creates functions and families RSVP.</p>}
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
              {updatedBy.get(r.event_id) && (
                <span className="text-xs text-stone-500" data-testid="meal-updated-by">
                  {" "}· by {updatedBy.get(r.event_id)!.who}, {new Date(updatedBy.get(r.event_id)!.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" })}
                </span>
              )}
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
