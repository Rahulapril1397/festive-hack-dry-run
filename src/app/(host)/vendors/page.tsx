import Link from "next/link";
import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { listEvents } from "@/lib/db/service";
import { listCategories, listVendors, phoneLinks } from "@/domain/vendors/service";
import { VendorQuery } from "@/contracts/vendors";
import { VendorFilters } from "./VendorFilters";

export const dynamic = "force-dynamic";

/** Vendor directory (Stage 3 E3): search, filters, one-tap call / WhatsApp / email. */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requirePage("vendors.contacts.read", "/vendors");
  const q = VendorQuery.parse(await searchParams);
  const [vendors, categories, events, canManage] = await Promise.all([listVendors(s, q), listCategories(s.weddingId), listEvents(s.weddingId), hasPermission(s, "vendors.manage")]);
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Vendors</h1>
        {canManage && (
          <Link href="/vendors/new" className="btn-primary" data-testid="new-vendor">
            Add vendor
          </Link>
        )}
      </div>
      <VendorFilters categories={categories} events={events.map((e) => ({ id: e.id, name: e.name }))} value={q} />
      {vendors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">{q.q || q.categoryId || q.eventId ? "No vendors match." : canManage ? "No vendors yet — add your caterer, decorator, photographer…" : "No vendors yet."}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="vendor-list">
          {vendors.map((v) => {
            const c = v.primaryContact;
            const links = phoneLinks(c?.phone ?? null);
            return (
              <li key={v.id} className={`flex flex-col gap-2 rounded-xl border bg-white p-4 ${v.status === "inactive" ? "opacity-60" : ""}`} data-testid="vendor-card">
                <Link href={`/vendors/${v.id}`} className="group">
                  <p className="text-xs uppercase tracking-wide text-rose-700">{v.categoryName}</p>
                  <p className="text-lg font-semibold group-hover:underline">{v.name}</p>
                  {v.businessName && <p className="text-sm text-stone-500">{v.businessName}</p>}
                </Link>
                {v.events.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.events.map((e) => (
                      <span key={e.id} className="rounded bg-stone-100 px-2 py-0.5 text-xs">
                        {e.name}
                      </span>
                    ))}
                  </div>
                )}
                {v.contractStatus && v.contractStatus !== "none" && <p className="text-xs text-stone-500">Contract: {v.contractStatus}</p>}
                {c && (
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                    <span className="flex-1 truncate text-stone-600">
                      {c.name}
                      {c.role ? ` · ${c.role}` : ""}
                    </span>
                    {links && (
                      <a href={links.tel} className="rounded-lg border px-2 py-1 hover:bg-stone-50" aria-label={`Call ${c.name}`}>
                        📞 Call
                      </a>
                    )}
                    {links && c.whatsapp && (
                      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className="rounded-lg border px-2 py-1 hover:bg-stone-50" aria-label={`WhatsApp ${c.name}`}>
                        💬 WhatsApp
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="rounded-lg border px-2 py-1 hover:bg-stone-50" aria-label={`Email ${c.name}`}>
                        ✉️
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
