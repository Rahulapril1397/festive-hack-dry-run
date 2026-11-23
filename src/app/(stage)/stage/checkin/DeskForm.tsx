"use client";

import { useEffect, useState } from "react";
import type { CheckinResult } from "@/contracts/queue";

type Row = {
  family_id: string;
  name: string;
  phone_last4: string | null;
  token: number | null;
  is_walk_in: boolean;
  checked_in: boolean;
  queue_status: string | null;
};

export function DeskForm({ events }: { events: { id: string; name: string }[] }) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [walk, setWalk] = useState({ name: "", phone: "", language: "en" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!eventId || q.trim().length < 1) return setRows([]);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/checkin/lookup?eventId=${eventId}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).catch(() => null);
      if (res?.ok) setRows((await res.json()).results);
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, eventId]);

  async function send(url: string, body: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error?.code === "FAMILY_EXISTS" ? "A family with that phone already exists — search for it above." : data?.error?.message ?? "Failed" });
        return null;
      }
      const r = data as CheckinResult;
      setMsg({ kind: "ok", text: `Token ${r.token}${r.position ? ` · number ${r.position} in queue` : ""}` });
      return r;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-center gap-3">
        <span className="font-medium">Event</span>
        <select className="input max-w-xs" value={eventId} onChange={(e) => setEventId(e.target.value)} data-testid="desk-event">
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      {msg && (
        <p role="status" className={`rounded-lg p-4 text-xl font-semibold ${msg.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`} data-testid="desk-msg">
          {msg.text}
        </p>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Find a family</h2>
        <input className="input" placeholder="Name, phone digits or token" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="mt-3 divide-y divide-stone-100">
          {rows.map((r) => (
            <li key={r.family_id} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                {r.name} {r.phone_last4 && <span className="text-stone-500">· …{r.phone_last4}</span>}
                {r.token && <span className="ml-2 font-bold">#{r.token}</span>}
              </span>
              {r.checked_in ? (
                <span className="text-sm text-stone-500">checked in · {r.queue_status?.replace("_", " ")}</span>
              ) : (
                <button className="btn-primary text-sm" disabled={busy} onClick={async () => {
                    const res = await send("/api/checkin/desk", { eventId, familyId: r.family_id });
                    if (res) setRows((all) => all.map((x) => (x.family_id === r.family_id ? { ...x, checked_in: true, token: res.token, queue_status: res.status } : x)));
                  }}>
                  Check in
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Walk-in</h2>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_12rem_8rem_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await send("/api/checkin/walk-in", { eventId, name: walk.name, phone: walk.phone || null, language: walk.language });
            if (r) setWalk({ name: "", phone: "", language: "en" });
          }}
        >
          <input className="input" placeholder="Family name" value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} required minLength={2} data-testid="walkin-name" />
          <input className="input" placeholder="Phone (optional)" inputMode="tel" value={walk.phone} onChange={(e) => setWalk({ ...walk, phone: e.target.value })} />
          <select className="input" value={walk.language} onChange={(e) => setWalk({ ...walk, language: e.target.value })}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
          <button className="btn-primary" disabled={busy} data-testid="walkin-submit">
            Add walk-in
          </button>
        </form>
      </section>
    </div>
  );
}
