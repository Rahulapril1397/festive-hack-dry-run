"use client";

import { useCallback, useEffect, useState } from "react";
import type { LedgerAccess } from "@/domain/ledger/service";
import type { ApiLedgerRow, LedgerSummary } from "@/domain/ledger/model";

type Ev = { id: string; name: string };
type Fam = { id: string; name: string; token: number | null };
const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const METHOD_LABEL = { cash: "Cash", upi: "UPI", boxed_gift: "Boxed gift" } as const;

export function LedgerScreen({ access, events }: { access: LedgerAccess; events: Ev[] }) {
  const [filters, setFilters] = useState({ eventId: "", date: "", token: "", method: "", reconciliation: "" });
  const [rows, setRows] = useState<ApiLedgerRow[]>([]);
  const [summary, setSummary] = useState<Partial<LedgerSummary>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  const load = useCallback(async () => {
    const res = await fetch(`/api/ledger?${qs}`, { cache: "no-store" });
    if (!res.ok) return setMsg("Could not load the ledger");
    const body = await res.json();
    setRows(body.entries);
    setSummary(body.summary);
  }, [qs]);
  useEffect(() => {
    void load();
  }, [load]);

  const post = async (url: string, body: unknown, ok: string) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? ok : (j?.error?.issues?.[0]?.message ?? j?.error?.message ?? "Failed"));
    if (res.ok) await load();
    return res.ok;
  };

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Shagun Ledger</h1>
        {access.export && (
          <a className="btn-secondary" href={`/api/ledger/export?${qs}`} data-testid="export">
            Export CSV
          </a>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="summary">
        <Card label="Entries" value={summary.entries ?? "—"} />
        {access.amounts ? (
          <>
            <Card label="Cash total" value={inr(summary.cashTotal ?? 0)} testid="cash-total" />
            <Card label="UPI total" value={inr(summary.upiTotal ?? 0)} testid="upi-total" />
            <Card label="Boxed gifts" value={summary.boxedGifts ?? 0} />
            <Card label="Unmatched envelopes" value={summary.unmatchedEnvelopes ?? 0} />
          </>
        ) : (
          <p className="col-span-full text-sm text-stone-500">Amounts and totals need the ledger.read permission.</p>
        )}
      </section>

      {access.write && <EntryForm events={events} onSubmit={(b) => post("/api/ledger", b, "Entry added")} />}
      {msg && (
        <p className="text-sm" role="status" data-testid="ledger-msg">
          {msg}
        </p>
      )}

      <section className="flex flex-wrap gap-2 text-sm">
        <select className="rounded border px-2 py-1" value={filters.eventId} onChange={(e) => setFilters({ ...filters, eventId: e.target.value })} aria-label="Function">
          <option value="">All functions</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input className="rounded border px-2 py-1" type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} aria-label="Date" />
        <input className="rounded border px-2 py-1" placeholder="Token ref" value={filters.token} onChange={(e) => setFilters({ ...filters, token: e.target.value })} />
        <select className="rounded border px-2 py-1" value={filters.method} onChange={(e) => setFilters({ ...filters, method: e.target.value })} aria-label="Payment type">
          <option value="">All payment types</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="boxed_gift">Boxed gift</option>
        </select>
        <select className="rounded border px-2 py-1" value={filters.reconciliation} onChange={(e) => setFilters({ ...filters, reconciliation: e.target.value })} aria-label="Reconciliation">
          <option value="">Any reconciliation</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
        </select>
      </section>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm" data-testid="ledger-table">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="p-2">When</th>
              <th className="p-2">Function</th>
              <th className="p-2">Family / token</th>
              <th className="p-2">Type</th>
              {access.amounts && <th className="p-2 text-right">Amount</th>}
              <th className="p-2">Notes</th>
              <th className="p-2">Status</th>
              {access.write && <th className="p-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t ${r.status !== "active" ? "text-stone-400" : ""}`}>
                <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="p-2">{r.event_name ?? "—"}</td>
                <td className="p-2">{r.family_name ?? <span className="text-amber-700">{r.token_reference ?? "unmatched"}</span>}</td>
                <td className="p-2">
                  {METHOD_LABEL[r.payment_method]}
                  {r.payment_method === "boxed_gift" && r.gift_type !== "shagun" ? ` · ${r.gift_type}` : ""}
                </td>
                {access.amounts && <td className="p-2 text-right tabular-nums">{r.amount == null ? "—" : inr(r.amount)}</td>}
                <td className="p-2">{r.notes}</td>
                <td className="p-2">{r.status === "active" ? (r.reconciled ? "reconciled" : "open") : r.status}</td>
                {access.write && (
                  <td className="p-2 whitespace-nowrap">
                    {r.status === "active" && (
                      <>
                        <Reconcile onPick={(f) => post(`/api/ledger/${r.id}/reconcile`, { familyId: f.id }, `Reconciled to ${f.name}`)} />
                        <button className="ml-2 text-xs text-red-700 underline" onClick={() => post(`/api/ledger/${r.id}/reverse`, { notes: "Correction" }, "Entry reversed — add the corrected entry")}>
                          Reverse
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-4 text-stone-500" colSpan={8}>
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Card({ label, value, testid }: { label: string; value: React.ReactNode; testid?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-xl font-bold" data-testid={testid}>
        {value}
      </p>
    </div>
  );
}

function FamilyPicker({ onPick, placeholder = "Family name or token" }: { onPick: (f: Fam) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Fam[]>([]);
  useEffect(() => {
    if (!q.trim()) return setList([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/ledger/families?q=${encodeURIComponent(q)}`);
      if (res.ok) setList((await res.json()).families);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative inline-block">
      <input className="rounded border px-2 py-1 text-sm" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} data-testid="family-search" />
      {list.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-64 overflow-auto rounded border bg-white shadow">
          {list.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left text-sm hover:bg-stone-100"
                onClick={() => {
                  onPick(f);
                  setQ(f.name);
                  setList([]);
                }}
              >
                {f.name} {f.token ? `· #${f.token}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Reconcile({ onPick }: { onPick: (f: Fam) => void }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <FamilyPicker onPick={(f) => (setOpen(false), onPick(f))} placeholder="Match to family" />
  ) : (
    <button className="text-xs underline" onClick={() => setOpen(true)}>
      Reconcile
    </button>
  );
}

function EntryForm({ events, onSubmit }: { events: Ev[]; onSubmit: (b: unknown) => Promise<boolean> }) {
  const empty = { family: null as Fam | null, eventId: events.at(-1)?.id ?? "", tokenReference: "", paymentMethod: "cash", amount: "", giftType: "", notes: "" };
  const [f, setF] = useState(empty);
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 md:grid-cols-4"
      data-testid="entry-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSubmit({
          familyId: f.family?.id ?? null,
          eventId: f.eventId || null,
          tokenReference: f.tokenReference || null,
          paymentMethod: f.paymentMethod,
          amount: f.amount ? Number(f.amount) : null,
          giftType: f.giftType || undefined,
          notes: f.notes || null,
        });
        if (ok) {
          setF(empty);
          setKey((k) => k + 1);
        }
      }}
    >
      <h2 className="font-semibold md:col-span-4">Add entry</h2>
      <FamilyPicker onPick={(fam) => setF({ ...f, family: fam })} />
      <input className="rounded border px-2 py-1" placeholder="…or token / envelope ref" value={f.tokenReference} onChange={(e) => setF({ ...f, tokenReference: e.target.value })} data-testid="token-ref" />
      <select className="rounded border px-2 py-1" value={f.eventId} onChange={(e) => setF({ ...f, eventId: e.target.value })} aria-label="Function">
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <select className="rounded border px-2 py-1" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} data-testid="method" aria-label="Type">
        <option value="cash">Cash</option>
        <option value="upi">UPI</option>
        <option value="boxed_gift">Boxed gift</option>
      </select>
      <input className="rounded border px-2 py-1" type="number" step="0.01" min="0" placeholder={f.paymentMethod === "boxed_gift" ? "Amount (optional)" : "Amount ₹"} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="amount" />
      {f.paymentMethod === "boxed_gift" && <input className="rounded border px-2 py-1" placeholder="Gift (e.g. dinner set)" value={f.giftType} onChange={(e) => setF({ ...f, giftType: e.target.value })} />}
      <input className="rounded border px-2 py-1 md:col-span-2" placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <p className="text-xs text-stone-500 md:col-span-4">Recorded by you. Entries cannot be edited: to correct one, reverse it and add a new entry.</p>
      <button className="btn-primary md:col-span-1" data-testid="add-entry">
        Add entry
      </button>
    </form>
  );
}
