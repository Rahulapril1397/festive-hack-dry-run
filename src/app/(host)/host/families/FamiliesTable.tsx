"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FamilyRow } from "@/domain/host/queries";
import { copyText } from "@/components/shell/copyText";

type Ev = { id: string; name: string };
const CELL: Record<string, string> = { yes: "bg-green-100 text-green-900", no: "bg-stone-200 text-stone-600", pending: "text-stone-400" };

export function FamiliesTable({ events, families, can }: { events: Ev[]; families: FamilyRow[]; can: { write: boolean; rsvp: boolean } }) {
  const [q, setQ] = useState("");
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const [checked, setChecked] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return families.filter((f) => {
      if (term && !(f.name.toLowerCase().includes(term) || String(f.token ?? "") === term || (f.phoneLast4 ?? "").includes(term))) return false;
      if (status && (f.rsvp[eventId]?.status ?? "pending") !== status) return false;
      if (checked === "yes" && !f.checkedIn.includes(eventId)) return false;
      if (checked === "no" && f.checkedIn.includes(eventId)) return false;
      return true;
    });
  }, [families, q, eventId, status, checked]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <input className="rounded border px-2 py-1" placeholder="Search name, token, last 4 digits" value={q} onChange={(e) => setQ(e.target.value)} data-testid="family-search-box" />
        <select className="rounded border px-2 py-1" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Function">
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className="rounded border px-2 py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="RSVP status">
          <option value="">Any RSVP</option>
          <option value="yes">Attending</option>
          <option value="no">Not attending</option>
          <option value="pending">Pending</option>
        </select>
        <select className="rounded border px-2 py-1" value={checked} onChange={(e) => setChecked(e.target.value)} aria-label="Checked in">
          <option value="">Checked in: any</option>
          <option value="yes">Checked in</option>
          <option value="no">Not checked in</option>
        </select>
        <span className="self-center text-stone-500">{rows.length} shown</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm" data-testid="families-table">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="p-2">Family</th>
              <th className="p-2">Phone</th>
              <th className="p-2">Token</th>
              <th className="p-2">Travel</th>
              <th className="p-2">Food</th>
              {events.map((e) => <th key={e.id} className="p-2">{e.name}</th>)}
              {(can.write || can.rsvp) && <th className="p-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <FamilyRowView key={f.id} f={f} events={events} can={can} editing={editing === f.id} onEdit={() => setEditing(editing === f.id ? null : f.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FamilyRowView({ f, events, can, editing, onEdit }: { f: FamilyRow; events: Ev[]; can: { write: boolean; rsvp: boolean }; editing: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [link, setLink] = useState(f.link);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState(false); // copy blocked → show the link to copy by hand
  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2500);
  };
  return (
    <>
      <tr className="border-t" data-testid={`family-${f.name}`}>
        <td className="p-2">
          {f.name}
          {f.isWalkIn && <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">walk-in</span>}
        </td>
        <td className="p-2 font-mono text-xs">{f.phoneLast4 ? `••••${f.phoneLast4}` : "—"}</td>
        <td className="p-2">{f.token ?? "—"}</td>
        <td className="p-2 text-xs" data-testid="trip-cell">
          {f.trip && (f.trip.mode || f.trip.arrivalAt) ? (
            <>
              {[f.trip.mode, f.trip.number].filter(Boolean).join(" ")}
              {f.trip.count != null && ` · ${f.trip.count} people`}
              {f.trip.arrivalAt && <div className="text-stone-500">{new Date(f.trip.arrivalAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</div>}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="p-2 text-xs">
          {f.trip?.food ? f.trip.food.replace("_", "-") : "—"}
          {f.trip?.note && <div className="text-stone-500">{f.trip.note}</div>}
        </td>
        {events.map((e) => {
          const r = f.rsvp[e.id];
          return (
            <td key={e.id} className={`p-2 ${CELL[r?.status ?? "pending"]}`}>
              {r?.status === "yes" ? `yes · ${r.headcount}` : (r?.status ?? "pending")}
              {f.checkedIn.includes(e.id) && <span title="checked in"> ✓</span>}
            </td>
          );
        })}
        {(can.write || can.rsvp) && (
          <td className="whitespace-nowrap p-2 text-xs">
            {can.rsvp && <button className="underline" onClick={onEdit}>{editing ? "close" : "edit RSVP"}</button>}
            {can.write && link && (
              <>
                <button
                  className="ml-2 underline"
                  data-testid="copy-link"
                  onClick={async () => {
                    if (await copyText(link)) flash("Link copied");
                    else setManual(true);
                  }}
                >
                  copy link
                </button>
                <a className="ml-2 underline" href={`https://wa.me/?text=${encodeURIComponent(`Your family invitation: ${link}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                <button
                  className="ml-2 text-red-700 underline"
                  onClick={async () => {
                    const res = await fetch(`/api/admin/families/${f.id}/rotate-link`, { method: "POST" });
                    if (res.ok) {
                      setLink((await res.json()).link);
                      flash("New link issued — the old one no longer works");
                    } else flash("Could not rotate the link");
                  }}
                >
                  rotate link
                </button>
              </>
            )}
            {note && <span className="ml-2 text-green-700" role="status">{note}</span>}
            {manual && link && (
              <input
                readOnly
                autoFocus
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setManual(false)}
                className="ml-2 w-64 rounded border px-1 font-mono text-xs"
                aria-label="Family link — press Cmd+C or Ctrl+C to copy"
                data-testid="manual-link"
              />
            )}
          </td>
        )}
      </tr>
      {editing && (
        <tr className="bg-rose-50">
          <td colSpan={6 + events.length} className="p-3">
            <RsvpEditor family={f} events={events} onSaved={() => { onEdit(); router.refresh(); }} />
          </td>
        </tr>
      )}
    </>
  );
}

function RsvpEditor({ family, events, onSaved }: { family: FamilyRow; events: Ev[]; onSaved: () => void }) {
  const [rows, setRows] = useState(() => events.map((e) => ({ eventId: e.id, name: e.name, attending: family.rsvp[e.id]?.status === "yes", answered: (family.rsvp[e.id]?.status ?? "pending") !== "pending", headcount: family.rsvp[e.id]?.headcount || 2 })));
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      data-testid="rsvp-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const rsvps = rows.filter((r) => r.answered).map((r) => ({ eventId: r.eventId, attending: r.attending, headcount: r.attending ? r.headcount : 0 }));
        if (!rsvps.length) return setErr("Answer at least one function");
        const res = await fetch(`/api/host/families/${family.id}/rsvp`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rsvps }) });
        if (!res.ok) return setErr((await res.json().catch(() => null))?.error?.message ?? "Could not save");
        onSaved();
      }}
    >
      {rows.map((r, i) => (
        <fieldset key={r.eventId} className="rounded border bg-white p-2">
          <legend className="px-1 font-medium">{r.name}</legend>
          <select value={!r.answered ? "" : r.attending ? "yes" : "no"} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, answered: e.target.value !== "", attending: e.target.value === "yes" } : x)))} aria-label={`${r.name} RSVP`}>
            <option value="">no answer</option>
            <option value="yes">attending</option>
            <option value="no">not attending</option>
          </select>
          {r.attending && r.answered && (
            <input type="number" min={1} max={10} value={r.headcount} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, headcount: Number(e.target.value) } : x)))} className="ml-2 w-14 rounded border px-1" aria-label={`${r.name} guests`} />
          )}
        </fieldset>
      ))}
      <button className="btn-primary">Save RSVP</button>
      {err && <span className="text-red-700">{err}</span>}
    </form>
  );
}
