"use client";

import { useState } from "react";

type Profile = { travelMode: string | null; travelNumber: string | null; arrivalAt: string | null; departureAt: string | null; arrivingCount: number | null; foodPref: string | null; foodNote: string | null };
type Labels = Record<string, string>;

const MODES = ["train", "flight", "car", "bus", "other"] as const;
const FOODS = ["veg", "non_veg", "jain", "vegan"] as const;

/** "Your journey and your plate": travel mode and number, arrival, how many travel, food preference. All optional. */
export function ProfileForm({ initial, labels, defaultCount }: { initial: Profile; labels: Labels; defaultCount: number }) {
  const [p, setP] = useState({
    travelMode: initial.travelMode ?? "",
    travelNumber: initial.travelNumber ?? "",
    arrivalAt: initial.arrivalAt ?? "",
    departureAt: initial.departureAt ?? "",
    arrivingCount: initial.arrivingCount ?? defaultCount,
    foodPref: initial.foodPref ?? "",
    foodNote: initial.foodNote ?? "",
  });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "invalid" | "error">("idle");
  const set = (patch: Partial<typeof p>) => {
    setP((x) => ({ ...x, ...patch }));
    setState("idle");
  };
  const numberLabel = p.travelMode === "flight" ? labels.flightNo : p.travelMode === "train" ? labels.trainNo : labels.vehicleNo;
  const hasNumber = p.travelMode === "train" || p.travelMode === "flight";

  async function save() {
    setState("saving");
    const res = await fetch("/api/guest/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...p, travelNumber: hasNumber ? p.travelNumber : "", arrivingCount: p.arrivingCount }),
    }).catch(() => null);
    setState(res?.ok ? "saved" : res?.status === 400 ? "invalid" : "error");
  }

  return (
    <section className="card flex flex-col gap-4 p-5" data-testid="profile-form">
      <h2 className="text-2xl font-bold text-rose-900">🚆 {labels.title}</h2>
      <p className="-mt-2 text-sm text-stone-600">{labels.intro}</p>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-rose-800">{labels.travelHeading}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={labels.mode}>
          {MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={p.travelMode === m} data-testid={`mode-${m}`} className={`rounded-full px-4 py-1.5 text-sm ${p.travelMode === m ? "btn-primary" : "btn-secondary"}`} onClick={() => set({ travelMode: p.travelMode === m ? "" : m })}>
              {labels[`mode.${m}`]}
            </button>
          ))}
        </div>
        {hasNumber && (
          <label className="text-sm">
            {numberLabel}
            <input className="input mt-1" maxLength={12} value={p.travelNumber} onChange={(e) => set({ travelNumber: e.target.value })} placeholder={p.travelMode === "flight" ? "AI 101" : "12951"} data-testid="travel-number" autoCapitalize="characters" />
          </label>
        )}
        <label className="text-sm">
          {labels.arrival}
          <input type="datetime-local" className="input mt-1" value={p.arrivalAt} onChange={(e) => set({ arrivalAt: e.target.value })} data-testid="arrival-at" />
        </label>
        <label className="text-sm">
          {labels.departure}
          <input type="datetime-local" className="input mt-1" value={p.departureAt} onChange={(e) => set({ departureAt: e.target.value })} data-testid="departure-at" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>{labels.count}</span>
          <input type="number" inputMode="numeric" min={0} max={30} className="input w-24 text-center" value={p.arrivingCount} onChange={(e) => set({ arrivingCount: Number(e.target.value) })} data-testid="arriving-count" />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-rose-800">🍛 {labels.foodHeading}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={labels.foodHeading}>
          {FOODS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={p.foodPref === f} data-testid={`food-${f}`} className={`rounded-full px-4 py-1.5 text-sm ${p.foodPref === f ? "btn-primary" : "btn-secondary"}`} onClick={() => set({ foodPref: p.foodPref === f ? "" : f })}>
              {labels[`food.${f}`]}
            </button>
          ))}
        </div>
        <label className="text-sm">
          {labels.foodNote}
          <input className="input mt-1" maxLength={200} value={p.foodNote} onChange={(e) => set({ foodNote: e.target.value })} placeholder={labels.foodNoteHint} data-testid="food-note" />
        </label>
      </fieldset>

      <button className="btn-primary w-full py-3 text-lg" onClick={save} disabled={state === "saving"} data-testid="profile-save">
        {state === "saving" ? labels.saving : labels.save}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-center text-sm" data-testid="profile-state">
        {state === "saved" && <span className="text-green-700">{labels.saved}</span>}
        {state === "invalid" && <span className="text-red-700">{labels.invalid}</span>}
        {state === "error" && <span className="text-red-700">{labels.error}</span>}
      </p>
    </section>
  );
}
