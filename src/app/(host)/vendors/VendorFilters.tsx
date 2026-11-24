"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Opt = { id: string; name: string };

export function VendorFilters({ categories, events, value }: { categories: Opt[]; events: Opt[]; value: { q?: string; categoryId?: string; eventId?: string; status?: string } }) {
  const router = useRouter();
  const [q, setQ] = useState(value.q ?? "");
  const push = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: value.q, categoryId: value.categoryId, eventId: value.eventId, status: value.status, ...patch }).filter(([, v]) => v) as [string, string][]);
    router.replace(`/vendors${p.size ? `?${p}` : ""}`);
  };
  useEffect(() => {
    if (q === (value.q ?? "")) return;
    const t = setTimeout(() => push({ q: q || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on typing only
  }, [q]);
  return (
    <div className="flex flex-wrap gap-2 text-sm" role="search">
      <input className="min-w-48 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5" placeholder="Search name, service, contact or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vendors" data-testid="vendor-search" />
      <select className="rounded-lg border border-stone-300 bg-white px-2 py-1.5" value={value.categoryId ?? ""} onChange={(e) => push({ categoryId: e.target.value || undefined })} aria-label="Category">
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="rounded-lg border border-stone-300 bg-white px-2 py-1.5" value={value.eventId ?? ""} onChange={(e) => push({ eventId: e.target.value || undefined })} aria-label="Function">
        <option value="">All functions</option>
        {events.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="rounded-lg border border-stone-300 bg-white px-2 py-1.5" value={value.status ?? "active"} onChange={(e) => push({ status: e.target.value === "active" ? undefined : e.target.value })} aria-label="Status">
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="all">All</option>
      </select>
    </div>
  );
}
