"use client";

import { useState } from "react";
import { EventBanner } from "@/components/guest/EventBanner";

type Ev = { id: string; name: string; startsLabel: string | null; line: string; meaning: string };
type Initial = { eventId: string; status: "pending" | "yes" | "no"; headcount: number };
type Labels = Record<"heading" | "attending" | "notAttending" | "headcount" | "save" | "saving" | "saved" | "invalid" | "error", string>;
type Row = { attending: boolean | null; headcount: number };

export function RsvpForm({ events, initial, labels }: { events: Ev[]; initial: Initial[]; labels: Labels }) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      events.map((e) => {
        const r = initial.find((i) => i.eventId === e.id);
        return [e.id, { attending: r?.status === "yes" ? true : r?.status === "no" ? false : null, headcount: r?.headcount || 2 }];
      }),
    ),
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "invalid" | "error">("idle");

  const set = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));
    setState("idle");
  };

  async function save() {
    const answered = Object.entries(rows).filter(([, r]) => r.attending !== null);
    if (!answered.length || answered.some(([, r]) => r.attending && (r.headcount < 1 || r.headcount > 10))) {
      return setState("invalid");
    }
    setState("saving");
    const res = await fetch("/api/guest/rsvp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rsvps: answered.map(([eventId, r]) => ({ eventId, attending: r.attending, headcount: r.attending ? r.headcount : 0 })) }),
    }).catch(() => null);
    setState(res?.ok ? "saved" : res?.status === 400 ? "invalid" : "error");
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-rose-900">{labels.heading}</h2>
      {events.map((e) => {
        const r = rows[e.id]!;
        return (
          <div key={e.id} className="overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-sm" data-testid={`rsvp-${e.name}`}>
            <EventBanner name={e.name} meaning={e.meaning} />
            <div className="p-4">
            {e.startsLabel && <p className="text-sm font-semibold text-rose-800">🪔 {e.startsLabel}</p>}
            <p className="mt-1 text-stone-700">{e.line}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={r.attending === true ? "btn-primary" : "btn-secondary"}
                onClick={() => set(e.id, { attending: true })}
                data-testid={`attend-${e.name}`}
                aria-pressed={r.attending === true}
              >
                {labels.attending}
              </button>
              <button
                type="button"
                className={r.attending === false ? "btn-primary" : "btn-secondary"}
                onClick={() => set(e.id, { attending: false })}
                aria-pressed={r.attending === false}
              >
                {labels.notAttending}
              </button>
            </div>
            {r.attending && (
              <label className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm">{labels.headcount}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  className="input w-24 text-center"
                  value={r.headcount}
                  onChange={(ev) => set(e.id, { headcount: Number(ev.target.value) })}
                  data-testid={`headcount-${e.name}`}
                />
              </label>
            )}
            </div>
          </div>
        );
      })}
      <button className="btn-primary w-full py-3 text-lg" onClick={save} disabled={state === "saving"} data-testid="rsvp-save">
        {state === "saving" ? labels.saving : labels.save}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-center text-sm" data-testid="rsvp-state">
        {state === "saved" && <span className="text-green-700">{labels.saved}</span>}
        {state === "invalid" && <span className="text-red-700">{labels.invalid}</span>}
        {state === "error" && <span className="text-red-700">{labels.error}</span>}
      </p>
    </section>
  );
}
