"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VendorDetail } from "@/contracts/vendors";
import { api } from "@/components/shell/api";

type Opt = { id: string; name: string };
const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");
const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
};

export function VendorDetailView({ vendor: v, events }: { vendor: VendorDetail; events: Opt[] }) {
  const router = useRouter();
  const tabs = ["Overview", ...(v.commercial ? ["Commercial"] : []), ...(v.documents ? ["Documents"] : []), "Notes", ...(v.tasks ? ["Tasks"] : [])];
  const [tab, setTab] = useState(tabs[0]!);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  };

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <Link href="/vendors" className="text-sm text-rose-700 underline">
        ← Vendors
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-rose-700">{v.categoryName}</p>
          <h1 className="text-2xl font-bold">
            {v.name}
            {v.status === "inactive" && <span className="ml-2 rounded bg-stone-200 px-2 align-middle text-sm font-normal">inactive</span>}
          </h1>
          {(v.businessName || v.city) && <p className="text-stone-600">{[v.businessName, v.city].filter(Boolean).join(" · ")}</p>}
        </div>
        {v.can.manage && (
          <div className="flex gap-2">
            <Link href={`/vendors/${v.id}/edit`} className="btn-secondary !py-1.5">
              Edit
            </Link>
            <button className="btn-secondary !py-1.5" onClick={() => run(() => api(`/api/vendors/${v.id}/status`, { method: "POST", body: { status: v.status === "active" ? "inactive" : "active" } }), v.status === "active" ? "Vendor deactivated" : "Vendor reactivated")}>
              {v.status === "active" ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        )}
      </div>
      <nav className="flex gap-2 overflow-x-auto border-b" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t ? "border-rose-700 font-semibold" : "border-transparent text-stone-600"}`} data-testid={`vendor-tab-${t}`}>
            {t}
          </button>
        ))}
      </nav>
      {msg && <p className={`rounded p-2 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{msg.text}</p>}

      {tab === "Overview" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {v.services && <p className="whitespace-pre-wrap rounded-xl border bg-white p-4 text-sm">{v.services}</p>}
            {v.website && (
              <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-sm text-rose-700 underline">
                {v.website}
              </a>
            )}
            <h2 className="font-semibold">Contacts</h2>
            {v.contacts === null ? (
              <p className="text-sm text-stone-500">You don&apos;t have access to contact details.</p>
            ) : v.contacts.length === 0 ? (
              <p className="text-sm text-stone-500">No contacts yet.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="vendor-contacts">
                {v.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-sm">
                    <span className="flex-1">
                      <b>{c.name}</b>
                      {c.role && <span className="text-stone-500"> · {c.role}</span>}
                      {c.isPrimary && <span className="ml-1 rounded bg-rose-50 px-1.5 text-xs text-rose-800">main</span>}
                      {c.phone && <span className="block text-stone-600">{c.phone}</span>}
                    </span>
                    {c.phone && (
                      <a className="rounded-lg border px-2 py-1" href={`tel:${c.phone}`}>
                        📞 Call
                      </a>
                    )}
                    {c.phone && c.whatsapp && (
                      <a className="rounded-lg border px-2 py-1" href={waLink(c.phone)} target="_blank" rel="noopener noreferrer">
                        💬 WhatsApp
                      </a>
                    )}
                    {c.email && (
                      <a className="rounded-lg border px-2 py-1" href={`mailto:${c.email}`}>
                        ✉️ Email
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="font-semibold">Booked for functions</h2>
            <ul className="flex flex-col gap-2" data-testid="vendor-events">
              {events.map((e) => {
                const a = v.events.find((x) => x.id === e.id);
                return (
                  <li key={e.id} className={`rounded-xl border p-3 text-sm ${a ? "border-rose-200 bg-white" : "border-dashed bg-stone-50"}`}>
                    <div className="flex items-center gap-2">
                      <b className="flex-1">{e.name}</b>
                      {v.can.manage && a && (
                        <button className="text-xs text-red-800 underline" onClick={() => run(() => api(`/api/vendors/${v.id}/events/${e.id}`, { method: "DELETE" }), `Removed from ${e.name}`)}>
                          Remove
                        </button>
                      )}
                    </div>
                    {a && (
                      <p className="text-stone-600">
                        {a.scope ?? "—"}
                        {a.arrivalAt && <> · arrives {fmt(a.arrivalAt)}</>}
                      </p>
                    )}
                    {v.can.manage && (
                      <form
                        className="mt-2 flex flex-wrap gap-2"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          const f = new FormData(ev.currentTarget);
                          const arr = String(f.get("arrivalAt") || "");
                          void run(() => api(`/api/vendors/${v.id}/events/${e.id}`, { method: "PUT", body: { scope: f.get("scope") || undefined, arrivalAt: arr ? new Date(arr).toISOString() : "" } }), `Booked for ${e.name}`);
                        }}
                      >
                        <input name="scope" defaultValue={a?.scope ?? ""} placeholder="What for (e.g. dinner for 300)" className="min-w-40 flex-1 rounded-lg border px-2 py-1" aria-label={`Scope for ${e.name}`} />
                        <input name="arrivalAt" type="datetime-local" className="rounded-lg border px-2 py-1" aria-label={`Arrival for ${e.name}`} />
                        <button className="btn-secondary !px-3 !py-1 text-sm">{a ? "Update" : "Book"}</button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {tab === "Commercial" && v.commercial && (
        <section className="grid gap-4 lg:grid-cols-2" data-testid="vendor-commercial">
          <div className="rounded-xl border bg-white p-4">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-stone-500">Quote</dt>
              <dd>{inr(v.commercial.quotedAmount)}</dd>
              <dt className="text-stone-500">Contract</dt>
              <dd className="font-semibold">{inr(v.commercial.contractAmount)}</dd>
              <dt className="text-stone-500">Paid so far</dt>
              <dd>{inr(v.commercial.paid)}</dd>
              <dt className="text-stone-500">Balance</dt>
              <dd>{v.commercial.contractAmount === null ? "—" : inr(v.commercial.contractAmount - v.commercial.paid)}</dd>
              <dt className="text-stone-500">Status</dt>
              <dd>{v.commercial.contractStatus}</dd>
            </dl>
            {v.commercial.paymentTerms && <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{v.commercial.paymentTerms}</p>}
            {v.can.commercialWrite && (
              <form
                className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() => api(`/api/vendors/${v.id}/commercial`, { method: "PUT", body: { quotedAmount: f.get("quotedAmount") ?? "", contractAmount: f.get("contractAmount") ?? "", paymentTerms: f.get("paymentTerms") ?? "", contractStatus: f.get("contractStatus") } }), "Commercial terms saved");
                }}
              >
                <label className="text-xs">
                  Quote (₹)
                  <input name="quotedAmount" type="number" min={0} step="0.01" defaultValue={v.commercial.quotedAmount ?? ""} className="input mt-1 !text-base" />
                </label>
                <label className="text-xs">
                  Contract (₹)
                  <input name="contractAmount" type="number" min={0} step="0.01" defaultValue={v.commercial.contractAmount ?? ""} className="input mt-1 !text-base" />
                </label>
                <label className="text-xs sm:col-span-2">
                  Payment terms
                  <textarea name="paymentTerms" rows={2} defaultValue={v.commercial.paymentTerms ?? ""} className="input mt-1 !text-base" />
                </label>
                <select name="contractStatus" defaultValue={v.commercial.contractStatus} className="input !text-base" aria-label="Contract status">
                  {["none", "quoted", "negotiating", "signed", "completed", "cancelled"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <button className="btn-primary !py-1.5">Save terms</button>
              </form>
            )}
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-2 font-semibold">Payments</h2>
            {v.commercial.payments.length === 0 && <p className="text-sm text-stone-500">No payments recorded.</p>}
            <ul className="flex flex-col gap-1 text-sm">
              {v.commercial.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap gap-2 border-b py-1 last:border-0">
                  <span className="w-20 capitalize">{p.kind}</span>
                  <span className={`font-semibold ${p.kind === "refund" ? "text-green-800" : ""}`}>{inr(p.amount)}</span>
                  <span className="text-stone-500">{p.paidAt ? `paid ${p.paidAt}` : p.dueAt ? `due ${p.dueAt}` : ""}</span>
                  {p.method && <span className="text-stone-500">{p.method}</span>}
                  {p.reference && <span className="text-stone-400">#{p.reference}</span>}
                </li>
              ))}
            </ul>
            {v.can.commercialWrite && (
              <form
                className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const form = e.currentTarget;
                  void run(async () => {
                    await api(`/api/vendors/${v.id}/payments`, { method: "POST", body: { kind: f.get("kind"), amount: f.get("amount"), paidAt: f.get("paidAt") ?? "", dueAt: f.get("dueAt") ?? "", method: f.get("method") ?? "", reference: f.get("reference") || undefined } });
                    form.reset();
                  }, "Payment recorded");
                }}
              >
                <select name="kind" className="input !text-base" aria-label="Kind">
                  <option value="advance">Advance</option>
                  <option value="payment">Payment</option>
                  <option value="refund">Refund</option>
                </select>
                <input name="amount" type="number" min={1} step="0.01" required placeholder="Amount ₹" className="input !text-base" aria-label="Amount" />
                <select name="method" className="input !text-base" aria-label="Method">
                  <option value="">Method…</option>
                  {["cash", "upi", "bank", "cheque", "card", "other"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <label className="text-xs">
                  Paid on
                  <input name="paidAt" type="date" className="input mt-1 !text-base" />
                </label>
                <label className="text-xs">
                  or due on
                  <input name="dueAt" type="date" className="input mt-1 !text-base" />
                </label>
                <input name="reference" placeholder="Reference / UTR" className="input self-end !text-base" aria-label="Reference" />
                <button className="btn-primary !py-1.5 sm:col-span-3">Record payment</button>
              </form>
            )}
          </div>
        </section>
      )}

      {tab === "Documents" && v.documents && <Documents v={v} run={run} />}

      {tab === "Notes" && (
        <section className="flex max-w-2xl flex-col gap-3">
          {(v.can.manage || v.can.commercialWrite) && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                void run(async () => {
                  await api(`/api/vendors/${v.id}/notes`, { method: "POST", body: { body: f.get("body"), restricted: f.get("restricted") === "on" } });
                  form.reset();
                }, "Note added");
              }}
            >
              <textarea name="body" required rows={3} className="input !text-base" placeholder="Add a note" aria-label="Note" />
              <div className="flex items-center gap-3">
                {v.can.commercialWrite && (
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="restricted" defaultChecked={!v.can.manage} disabled={!v.can.manage} /> Finance only (restricted)
                  </label>
                )}
                <button className="btn-secondary !py-1.5">Add note</button>
              </div>
            </form>
          )}
          <ul className="flex flex-col gap-2">
            {v.notes.length === 0 && <li className="text-sm text-stone-500">No notes.</li>}
            {v.notes.map((n) => (
              <li key={n.id} className={`rounded-xl border p-3 text-sm ${n.restricted ? "border-amber-200 bg-amber-50" : "bg-white"}`}>
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {n.by ?? "someone"} · {fmt(n.createdAt)}
                  {n.restricted && " · restricted"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "Tasks" && v.tasks && (
        <section className="flex flex-col gap-2">
          {v.tasks.length === 0 && <p className="text-sm text-stone-500">No tasks linked to this vendor. Link one from the task&apos;s edit form or create it on the Tasks screen.</p>}
          {v.tasks.map((t) => (
            <Link key={t.id} href={`/tasks?task=${t.id}`} className="flex gap-2 rounded-xl border bg-white p-3 text-sm hover:border-rose-300">
              <span className="flex-1 font-medium">{t.title}</span>
              <span className="text-stone-500">{t.status}</span>
              <span className="text-stone-500">{fmt(t.dueAt)}</span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}

function Documents({ v, run }: { v: VendorDetail; run: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="flex max-w-2xl flex-col gap-3" data-testid="vendor-documents">
      {v.can.manage && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const file = f.get("file") as File | null;
            if (!file?.size) return;
            const form = e.currentTarget;
            setBusy(true);
            void run(async () => {
              try {
                const meta = { fileName: file.name, contentType: file.type, sizeBytes: file.size };
                const u = await api<{ storagePath: string; uploadUrl: string }>(`/api/vendors/${v.id}/documents/upload`, { method: "POST", body: meta });
                const put = await fetch(u.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
                if (!put.ok) throw new Error("Upload failed");
                await api(`/api/vendors/${v.id}/documents`, { method: "POST", body: { ...meta, kind: f.get("kind"), storagePath: u.storagePath } });
                form.reset();
              } finally {
                setBusy(false);
              }
            }, "Document uploaded");
          }}
        >
          <select name="kind" className="input w-auto !text-base" aria-label="Document type">
            {["contract", "quote", "invoice", "receipt", "id", "other"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="text-sm" aria-label="File" />
          <button className="btn-primary !py-1.5" disabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
          <p className="w-full text-xs text-stone-500">PDF or image, up to 20 MB. Stored privately; download links expire after 5 minutes.</p>
        </form>
      )}
      <ul className="flex flex-col gap-2">
        {v.documents!.length === 0 && <li className="text-sm text-stone-500">No documents.</li>}
        {v.documents!.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-sm">
            <span className="rounded bg-stone-100 px-2 text-xs">{d.kind}</span>
            <a href={`/api/vendors/documents/${d.id}`} className="flex-1 truncate underline" target="_blank" rel="noopener noreferrer">
              {d.fileName}
            </a>
            <span className="text-xs text-stone-500">{Math.ceil(d.sizeBytes / 1024)} KB</span>
            {v.can.manage && (
              <button className="text-xs text-red-800 underline" onClick={() => run(() => api(`/api/vendors/documents/${d.id}`, { method: "DELETE" }), "Document deleted")}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
