"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VendorInput, type VendorCategory, type VendorDetail } from "@/contracts/vendors";
import { api } from "@/components/shell/api";

type ContactDraft = { name: string; role: string; phone: string; email: string; whatsapp: boolean; isPrimary: boolean };
const blank = (primary = false): ContactDraft => ({ name: "", role: "", phone: "", email: "", whatsapp: true, isPrimary: primary });

/** New / edit vendor. Client-side Zod (same schema as the API) + "possible duplicate" warning. */
export function VendorForm({ categories, initial }: { categories: VendorCategory[]; initial?: VendorDetail }) {
  const router = useRouter();
  const [f, setF] = useState({
    categoryId: initial?.categoryId ?? "",
    name: initial?.name ?? "",
    businessName: initial?.businessName ?? "",
    city: initial?.city ?? "",
    website: initial?.website ?? "",
    services: initial?.services ?? "",
  });
  const [contacts, setContacts] = useState<ContactDraft[]>(
    initial?.contacts?.length ? initial.contacts.map((c) => ({ name: c.name, role: c.role ?? "", phone: c.phone ?? "", email: c.email ?? "", whatsapp: c.whatsapp, isPrimary: c.isPrimary })) : [blank(true)],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<{ id: string; name: string; reason: string }[]>([]);
  const [confirmDupe, setConfirmDupe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const checkDupes = async () => {
    const phone = contacts.find((c) => c.phone)?.phone ?? "";
    if (f.name.trim().length < 2 && phone.length < 6) return setDupes([]);
    const p = new URLSearchParams({ name: f.name, phone, ...(initial ? { exclude: initial.id } : {}) });
    setDupes((await api<{ matches: typeof dupes }>(`/api/vendors/duplicates?${p}`).catch(() => ({ matches: [] }))).matches);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const body = { ...f, contacts: contacts.filter((c) => c.name.trim() || c.phone.trim() || c.email.trim()) };
    const parsed = VendorInput.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    if (!initial && dupes.length && !confirmDupe) {
      setConfirmDupe(true);
      return;
    }
    setBusy(true);
    try {
      const r = initial ? await api<{ id: string }>(`/api/vendors/${initial.id}`, { method: "PATCH", body: parsed.data }) : await api<{ id: string }>("/api/vendors", { method: "POST", body: { ...parsed.data, force: confirmDupe } });
      router.push(`/vendors/${r.id}`);
      router.refresh();
    } catch (x) {
      const m = (x as Error).message;
      setErr(m.includes("VENDOR_DUPLICATE") || m.includes("already") ? "A vendor with exactly this name already exists in this wedding." : m);
    } finally {
      setBusy(false);
    }
  };
  const fieldErr = (k: string) => errors[k] && <span className="text-xs text-red-700">{errors[k]}</span>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form className="flex max-w-2xl flex-col gap-4" onSubmit={submit} noValidate data-testid="vendor-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Category
          <select value={f.categoryId} onChange={set("categoryId")} className="input mt-1 !text-base" aria-invalid={!!errors.categoryId}>
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErr("categoryId")}
        </label>
        <label className="text-sm">
          Name
          <input value={f.name} onChange={set("name")} onBlur={checkDupes} className="input mt-1 !text-base" placeholder="e.g. Sharma Caterers" aria-invalid={!!errors.name} />
          {fieldErr("name")}
        </label>
        <label className="text-sm">
          Business name (optional)
          <input value={f.businessName} onChange={set("businessName")} className="input mt-1 !text-base" />
        </label>
        <label className="text-sm">
          City
          <input value={f.city} onChange={set("city")} className="input mt-1 !text-base" />
        </label>
        <label className="text-sm sm:col-span-2">
          Website (optional)
          <input value={f.website} onChange={set("website")} className="input mt-1 !text-base" placeholder="https://" aria-invalid={!!errors.website} />
          {fieldErr("website")}
        </label>
        <label className="text-sm sm:col-span-2">
          What they provide
          <textarea value={f.services} onChange={set("services")} rows={2} className="input mt-1 !text-base" placeholder="Veg menu for 300, live chaat counter…" />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Contacts</legend>
        {contacts.map((c, i) => (
          <div key={i} className="grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2">
            <input value={c.name} onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="input !text-base" placeholder="Contact name" aria-label="Contact name" />
            <input value={c.role} onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))} className="input !text-base" placeholder="Role (owner, manager…)" aria-label="Role" />
            <div>
              <input value={c.phone} onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} onBlur={checkDupes} inputMode="tel" className="input !text-base" placeholder="Phone" aria-label="Phone" aria-invalid={!!errors[`contacts.${i}.phone`]} />
              {fieldErr(`contacts.${i}.phone`)}
            </div>
            <div>
              <input value={c.email} onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))} type="email" className="input !text-base" placeholder="Email" aria-label="Email" />
              {fieldErr(`contacts.${i}.email`)}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={c.whatsapp} onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, whatsapp: e.target.checked } : x)))} /> On WhatsApp
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="primary" checked={c.isPrimary} onChange={() => setContacts(contacts.map((x, k) => ({ ...x, isPrimary: k === i })))} /> Main contact
              </label>
              {contacts.length > 1 && (
                <button type="button" className="ml-auto text-xs text-red-800 underline" onClick={() => setContacts(contacts.filter((_, k) => k !== i))}>
                  Remove
                </button>
              )}
            </div>
            {fieldErr(`contacts.${i}.name`)}
          </div>
        ))}
        {contacts.length < 10 && (
          <button type="button" className="self-start text-sm underline" onClick={() => setContacts([...contacts, blank()])}>
            + Another contact
          </button>
        )}
      </fieldset>

      {dupes.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert" data-testid="vendor-duplicate">
          <p className="font-semibold">Possible duplicate</p>
          <ul className="list-disc pl-5">
            {dupes.map((d) => (
              <li key={d.id + d.reason}>
                <a className="underline" href={`/vendors/${d.id}`} target="_blank" rel="noreferrer">
                  {d.name}
                </a>{" "}
                ({d.reason})
              </li>
            ))}
          </ul>
          {confirmDupe && <p className="mt-1">Press Save again to add it anyway.</p>}
        </div>
      )}
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-900">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add vendor"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
