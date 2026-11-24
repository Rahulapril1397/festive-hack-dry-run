import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { hasPermission, requirePermission, type Permission, type Session } from "@/lib/authz";
import { DOC_TYPES, type AssignEventInput, type CommercialInput, type DocumentInput, type NoteInput, type PaymentInput, type UploadInput, type Vendor, type VendorCategory, type VendorContact, type VendorDetail, type VendorInput, type VendorPatch, type VendorQuery } from "@/contracts/vendors";

/**
 * Vendors (Stage 3 E3). Every function checks its own permission in s.weddingId and only touches
 * rows of that wedding, so routes, PinkyBua and pages can't skip a check.
 *   contacts → vendors.contacts.read · edit → vendors.manage · money → vendors.commercial.* ·
 *   files → vendors.documents.read (download), vendors.manage (upload/delete)
 */
export const DOC_BUCKET = "vendor-docs";
const ANY_VENDOR: Permission[] = ["vendors.contacts.read", "vendors.manage", "vendors.commercial.read"];

async function can(s: Session) {
  const [contacts = false, manage = false, commercialRead = false, commercialWrite = false, documents = false] = await Promise.all(
    (["vendors.contacts.read", "vendors.manage", "vendors.commercial.read", "vendors.commercial.write", "vendors.documents.read"] as const).map((k) => hasPermission(s, k, s.weddingId)),
  );
  return { contacts: contacts || manage, manage, commercialRead, commercialWrite, documents };
}
async function requireAny(s: Session) {
  const c = await can(s);
  if (!c.contacts && !c.commercialRead) throw new AppError("FORBIDDEN");
  return c;
}
const need = (s: Session, key: Permission) => requirePermission(s, key, s.weddingId);

const paise = (rupees: number | "" | undefined) => (rupees === "" || rupees === undefined ? (rupees === "" ? "" : undefined) : String(Math.round(rupees * 100)));
const rupees = (p: number | string | null | undefined) => (p === null || p === undefined ? null : Number(p) / 100);

export async function listCategories(weddingId: string): Promise<VendorCategory[]> {
  const { data } = await db().from("vendor_category").select("id, key, name").eq("wedding_id", weddingId).order("sort");
  return (data ?? []) as VendorCategory[];
}

type VRow = {
  id: string;
  name: string;
  business_name: string | null;
  category_id: string;
  city: string | null;
  status: "active" | "inactive";
  website: string | null;
  services: string | null;
  category: { name: string } | null;
  vendor_contact: { id: string; name: string; role: string | null; phone: string | null; email: string | null; whatsapp: boolean; is_primary: boolean; sort: number }[];
  vendor_event_assignment: { scope: string | null; arrival_at: string | null; event: { id: string; name: string } | null }[];
  vendor_commercial: { contract_status: string } | { contract_status: string }[] | null;
};
const LIST_SELECT =
  "id, name, business_name, category_id, city, status, website, services, category:category_id(name), vendor_contact(id, name, role, phone, email, whatsapp, is_primary, sort), vendor_event_assignment(scope, arrival_at, event:event_id(id, name)), vendor_commercial(contract_status)";

const toContact = (c: VRow["vendor_contact"][number]): VendorContact => ({ id: c.id, name: c.name, role: c.role, phone: c.phone, email: c.email, whatsapp: c.whatsapp, isPrimary: c.is_primary });

function toVendor(r: VRow, c: { contacts: boolean; commercialRead: boolean }): Vendor {
  const contacts = [...(r.vendor_contact ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort - b.sort);
  const commercial = Array.isArray(r.vendor_commercial) ? r.vendor_commercial[0] : r.vendor_commercial;
  return {
    id: r.id,
    name: r.name,
    businessName: r.business_name,
    categoryId: r.category_id,
    categoryName: r.category?.name ?? "",
    city: r.city,
    status: r.status,
    primaryContact: c.contacts && contacts[0] ? toContact(contacts[0]) : null,
    events: (r.vendor_event_assignment ?? []).filter((a) => a.event).map((a) => ({ id: a.event!.id, name: a.event!.name, scope: a.scope, arrivalAt: a.arrival_at })),
    ...(c.commercialRead ? { contractStatus: commercial?.contract_status ?? "none" } : {}),
  };
}

export async function listVendors(s: Session, q: z.infer<typeof VendorQuery>): Promise<Vendor[]> {
  const c = await requireAny(s);
  let query = db().from("vendor").select(LIST_SELECT).eq("wedding_id", s.weddingId).order("name").limit(500);
  if (q.status !== "all") query = query.eq("status", q.status ?? "active");
  if (q.categoryId) query = query.eq("category_id", q.categoryId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as unknown as VRow[];
  if (q.eventId) rows = rows.filter((r) => r.vendor_event_assignment?.some((a) => a.event?.id === q.eventId));
  if (q.q?.trim()) {
    const needle = q.q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        (r.business_name ?? "").toLowerCase().includes(needle) ||
        (r.category?.name ?? "").toLowerCase().includes(needle) ||
        (r.services ?? "").toLowerCase().includes(needle) ||
        (c.contacts && r.vendor_contact?.some((x) => x.name.toLowerCase().includes(needle) || (digits.length >= 4 && (x.phone ?? "").includes(digits)))),
    );
  }
  return rows.map((r) => toVendor(r, c));
}

export async function getVendor(s: Session, id: string): Promise<VendorDetail> {
  const c = await requireAny(s);
  const { data, error } = await db().from("vendor").select(LIST_SELECT).eq("wedding_id", s.weddingId).eq("id", id).maybeSingle();
  if (error?.code === "22P02" || (!error && !data)) throw new AppError("NOT_FOUND");
  if (error) throw new Error(error.message);
  const r = data as unknown as VRow;
  const canTasks = await hasPermission(s, "tasks.read", s.weddingId);
  const [notes, commercial, payments, docs, tasks] = await Promise.all([
    db().from("vendor_note").select("id, body, restricted, created_at, created_by").eq("vendor_id", id).order("created_at", { ascending: false }).limit(200),
    c.commercialRead ? db().from("vendor_commercial").select("*").eq("vendor_id", id).maybeSingle() : Promise.resolve({ data: null }),
    c.commercialRead ? db().from("vendor_payment").select("*").eq("vendor_id", id).order("created_at") : Promise.resolve({ data: [] }),
    c.documents ? db().from("vendor_document").select("id, kind, file_name, content_type, size_bytes, created_at").eq("vendor_id", id).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    canTasks ? db().from("task").select("id, title, status, due_at").eq("wedding_id", s.weddingId).eq("vendor_id", id).order("due_at") : Promise.resolve({ data: null }),
  ]);
  const authors = [...new Set((notes.data ?? []).map((n) => n.created_by).filter(Boolean))] as string[];
  const { data: users } = authors.length ? await db().from("app_user").select("id, display_name, email").in("id", authors) : { data: [] };
  const who = new Map((users ?? []).map((u) => [u.id as string, (u.display_name as string | null) ?? (u.email as string)]));
  const pays = (payments.data ?? []) as { id: string; kind: string; amount_paise: number; due_at: string | null; paid_at: string | null; method: string | null; reference: string | null; note: string | null }[];
  const com = commercial.data as { quoted_amount_paise: number | null; contract_amount_paise: number | null; payment_terms: string | null; contract_status: string } | null;
  return {
    ...toVendor(r, c),
    website: r.website,
    services: r.services,
    contacts: c.contacts ? [...(r.vendor_contact ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort - b.sort).map(toContact) : null,
    notes: (notes.data ?? []).filter((n) => !n.restricted || c.commercialRead).map((n) => ({ id: n.id, body: n.body, restricted: n.restricted, createdAt: n.created_at, by: n.created_by ? (who.get(n.created_by) ?? null) : null })),
    commercial: c.commercialRead
      ? {
          quotedAmount: rupees(com?.quoted_amount_paise),
          contractAmount: rupees(com?.contract_amount_paise),
          paymentTerms: com?.payment_terms ?? null,
          contractStatus: com?.contract_status ?? "none",
          paid: pays.filter((p) => p.paid_at).reduce((n, p) => n + (p.kind === "refund" ? -1 : 1) * Number(p.amount_paise), 0) / 100,
          payments: pays.map((p) => ({ id: p.id, kind: p.kind, amount: Number(p.amount_paise) / 100, dueAt: p.due_at, paidAt: p.paid_at, method: p.method, reference: p.reference, note: p.note })),
        }
      : null,
    documents: c.documents ? (docs.data ?? []).map((d) => ({ id: d.id, kind: d.kind, fileName: d.file_name, contentType: d.content_type, sizeBytes: d.size_bytes, createdAt: d.created_at })) : null,
    tasks: canTasks ? (tasks.data ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.due_at })) : null,
    can: c,
  };
}

export async function findDuplicates(s: Session, name: string, phone: string, exclude?: string) {
  await need(s, "vendors.manage");
  return rpc<{ id: string; name: string; reason: string }[]>("vendor_duplicates", { p_wedding: s.weddingId, p_name: name, p_phone: phone, p_exclude: exclude ?? null });
}

export async function createVendor(s: Session, input: z.infer<typeof VendorInput>) {
  await need(s, "vendors.manage");
  return rpc<{ id: string }>("vendor_upsert", { p_actor: s.userId, p_wedding: s.weddingId, p_id: null, p: input });
}
export async function updateVendor(s: Session, id: string, input: z.infer<typeof VendorPatch>) {
  await need(s, "vendors.manage");
  return rpc<{ id: string }>("vendor_upsert", { p_actor: s.userId, p_wedding: s.weddingId, p_id: id, p: input });
}
export async function setVendorStatus(s: Session, id: string, status: "active" | "inactive") {
  await need(s, "vendors.manage");
  return rpc("vendor_set_status", { p_actor: s.userId, p_wedding: s.weddingId, p_vendor: id, p_status: status });
}
export async function assignToEvent(s: Session, id: string, eventId: string, input: z.infer<typeof AssignEventInput> | null) {
  await need(s, "vendors.manage");
  await rpc("vendor_assign_event", { p_actor: s.userId, p_wedding: s.weddingId, p_vendor: id, p_event: eventId, p_scope: input?.scope ?? null, p_arrival: input?.arrivalAt || null, p_remove: input === null });
}
export async function setCommercial(s: Session, id: string, input: z.infer<typeof CommercialInput>) {
  await need(s, "vendors.commercial.write");
  const p: Record<string, unknown> = {};
  if (input.quotedAmount !== undefined) p.quotedAmountPaise = paise(input.quotedAmount);
  if (input.contractAmount !== undefined) p.contractAmountPaise = paise(input.contractAmount);
  if (input.paymentTerms !== undefined) p.paymentTerms = input.paymentTerms;
  if (input.contractStatus !== undefined) p.contractStatus = input.contractStatus;
  await rpc("vendor_set_commercial", { p_actor: s.userId, p_wedding: s.weddingId, p_vendor: id, p });
}
export async function addPayment(s: Session, id: string, input: z.infer<typeof PaymentInput>) {
  await need(s, "vendors.commercial.write");
  await rpc("vendor_add_payment", { p_actor: s.userId, p_wedding: s.weddingId, p_vendor: id, p: { ...input, amountPaise: Math.round(input.amount * 100) } });
}
export async function addNote(s: Session, id: string, input: z.infer<typeof NoteInput>) {
  await need(s, input.restricted ? "vendors.commercial.write" : "vendors.manage");
  await rpc("vendor_add_note", { p_actor: s.userId, p_wedding: s.weddingId, p_vendor: id, p_body: input.body, p_restricted: input.restricted });
}

export async function documentUploadUrl(s: Session, vendorId: string, input: z.infer<typeof UploadInput>) {
  await need(s, "vendors.manage");
  const { data: v } = await db().from("vendor").select("id").eq("id", vendorId).eq("wedding_id", s.weddingId).maybeSingle();
  if (!v) throw new AppError("NOT_FOUND");
  const path = `${s.weddingId}/${vendorId}/${randomUUID()}.${DOC_TYPES[input.contentType]}`;
  const { data, error } = await db().storage.from(DOC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`upload url failed: ${error?.message}`);
  return { storagePath: path, uploadUrl: data.signedUrl };
}
export async function addDocument(s: Session, vendorId: string, input: z.infer<typeof DocumentInput>) {
  await need(s, "vendors.manage");
  return rpc("vendor_add_document", { p_actor: s.userId, p_wedding: s.weddingId, p_vendor: vendorId, p: input });
}
/** A 5-minute signed download link (documents are never public). */
export async function documentDownloadUrl(s: Session, docId: string): Promise<string> {
  await need(s, "vendors.documents.read");
  const { data } = await db().from("vendor_document").select("storage_path, file_name, vendor:vendor_id(wedding_id)").eq("id", docId).maybeSingle();
  if (!data || (data.vendor as unknown as { wedding_id: string } | null)?.wedding_id !== s.weddingId) throw new AppError("NOT_FOUND");
  const { data: u, error } = await db().storage.from(DOC_BUCKET).createSignedUrl(data.storage_path as string, 300, { download: data.file_name as string });
  if (error || !u) throw new Error(`download url failed: ${error?.message}`);
  return u.signedUrl;
}
export async function deleteDocument(s: Session, docId: string) {
  await need(s, "vendors.manage");
  const d = await rpc<{ storage_path: string }>("vendor_delete_document", { p_actor: s.userId, p_wedding: s.weddingId, p_document: docId });
  await db().storage.from(DOC_BUCKET).remove([d.storage_path]);
}

/** Functions screen + Host overview card. */
export async function vendorsByEvent(s: Session): Promise<Map<string, { id: string; name: string; category: string; scope: string | null; arrivalAt: string | null }[]>> {
  const out = new Map<string, { id: string; name: string; category: string; scope: string | null; arrivalAt: string | null }[]>();
  if (!(await hasPermission(s, "vendors.contacts.read", s.weddingId)) && !(await hasPermission(s, "vendors.manage", s.weddingId))) return out;
  const vendors = await listVendors(s, { status: "active" });
  for (const v of vendors) for (const e of v.events) out.set(e.id, [...(out.get(e.id) ?? []), { id: v.id, name: v.name, category: v.categoryName, scope: e.scope, arrivalAt: e.arrivalAt }]);
  return out;
}
export async function vendorSummary(s: Session): Promise<{ total: number; booked: number; unbooked: number; byCategory: { name: string; count: number }[] } | null> {
  const c = await can(s);
  if (!c.contacts && !c.commercialRead) return null;
  const vendors = await listVendors(s, { status: "active" });
  const by = new Map<string, number>();
  for (const v of vendors) by.set(v.categoryName, (by.get(v.categoryName) ?? 0) + 1);
  return {
    total: vendors.length,
    booked: vendors.filter((v) => v.events.length).length,
    unbooked: vendors.filter((v) => !v.events.length).length,
    byCategory: [...by.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

/** wa.me / tel: helpers (Indian numbers default to +91). */
export function phoneLinks(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return { tel: `tel:+${intl}`, whatsapp: `https://wa.me/${intl}` };
}

export { ANY_VENDOR };
