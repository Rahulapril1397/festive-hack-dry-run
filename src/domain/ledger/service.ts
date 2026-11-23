import "server-only";
import { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { hasPermission, type Session } from "@/lib/authz";
import { PAYMENT_METHODS, summarize, toApiRow, toCsv, type LedgerRow } from "./model";

export type LedgerAccess = { view: boolean; amounts: boolean; write: boolean; export: boolean };

/** Server-side gate for every ledger route and screen. */
export async function ledgerAccess(s: Session | null): Promise<LedgerAccess> {
  const [read, write, exp] = await Promise.all([hasPermission(s, "ledger.read"), hasPermission(s, "ledger.write"), hasPermission(s, "ledger.export")]);
  return { view: read || write, amounts: read, write, export: read && exp };
}

export const Filters = z.object({
  eventId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // IST calendar day
  token: z.string().trim().max(40).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reconciliation: z.enum(["matched", "unmatched"]).optional(),
});
export type LedgerFilters = z.infer<typeof Filters>;

export const AddEntry = z
  .object({
    familyId: z.string().uuid().nullable().optional(),
    eventId: z.string().uuid().nullable().optional(),
    tokenReference: z.string().trim().max(40).nullable().optional(),
    giftType: z.string().trim().max(40).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    amount: z.number().positive().max(10_000_000).multipleOf(0.01).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((e) => e.paymentMethod === "boxed_gift" || (e.amount ?? 0) > 0, { message: "Amount is required for cash and UPI", path: ["amount"] })
  .refine((e) => e.familyId || e.tokenReference, { message: "Choose a family or enter a token reference", path: ["familyId"] });

export async function listEntries(weddingId: string, f: LedgerFilters = {}): Promise<LedgerRow[]> {
  let q = db().from("v_ledger_entry").select("*").eq("wedding_id", weddingId).order("created_at", { ascending: false }).limit(1000);
  if (f.eventId) q = q.eq("event_id", f.eventId);
  if (f.method) q = q.eq("payment_method", f.method);
  if (f.token) q = q.ilike("token_reference", `%${f.token.replace(/[%_]/g, "")}%`);
  if (f.date) {
    const start = new Date(`${f.date}T00:00:00+05:30`);
    q = q.gte("created_at", start.toISOString()).lt("created_at", new Date(start.getTime() + 86_400_000).toISOString());
  }
  if (f.reconciliation === "matched") q = q.not("effective_family_id", "is", null);
  if (f.reconciliation === "unmatched") q = q.is("effective_family_id", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as LedgerRow[];

  const famIds = [...new Set(rows.map((r) => r.effective_family_id).filter(Boolean))] as string[];
  const [{ data: fams }, { data: evs }] = await Promise.all([
    famIds.length ? db().from("family").select("id, name").in("id", famIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    db().from("event").select("id, name").eq("wedding_id", weddingId),
  ]);
  const fName = new Map((fams ?? []).map((x) => [x.id, x.name]));
  const eName = new Map((evs ?? []).map((x) => [x.id, x.name]));
  return rows.map((r) => ({ ...r, family_name: r.effective_family_id ? (fName.get(r.effective_family_id) ?? null) : null, event_name: r.event_id ? (eName.get(r.event_id) ?? null) : null }));
}

/** API view: amounts and totals only with ledger.read. */
export async function ledgerView(s: Session, access: LedgerAccess, f: LedgerFilters) {
  const rows = await listEntries(s.weddingId, f);
  return {
    entries: rows.map((r) => toApiRow(r, access.amounts)),
    summary: access.amounts ? summarize(await listEntries(s.weddingId)) : { entries: rows.filter((r) => !r.is_reversal && !r.is_reversed).length },
  };
}

export async function addEntry(s: Session, input: z.infer<typeof AddEntry>) {
  return rpc<LedgerRow>("ledger_add", {
    p_wedding: s.weddingId,
    p_actor: s.userId,
    p_family: input.familyId ?? null,
    p_event: input.eventId ?? null,
    p_token_ref: input.tokenReference ?? null,
    p_gift_type: input.giftType ?? null,
    p_method: input.paymentMethod,
    p_amount: input.paymentMethod === "boxed_gift" ? (input.amount ?? null) : input.amount,
    p_notes: input.notes ?? null,
  });
}

export const reverseEntry = (s: Session, entryId: string, notes: string | null) =>
  rpc<LedgerRow>("ledger_reverse", { p_wedding: s.weddingId, p_actor: s.userId, p_entry: entryId, p_notes: notes });

export const reconcile = (s: Session, entryId: string, familyId: string) =>
  rpc<unknown>("ledger_reconcile", { p_wedding: s.weddingId, p_actor: s.userId, p_entry: entryId, p_family: familyId });

export async function exportCsv(s: Session, f: LedgerFilters): Promise<string> {
  const rows = await listEntries(s.weddingId, f);
  const { error } = await db()
    .from("audit_log")
    .insert({ wedding_id: s.weddingId, actor: s.userId, action: "ledger.export", data: { filters: f, rows: rows.length } });
  if (error) throw new Error(error.message);
  return toCsv(rows);
}

export async function searchFamilies(weddingId: string, q: string) {
  const term = q.trim();
  if (term.length < 1) return [];
  let query = db().from("family").select("id, name, token_number").eq("wedding_id", weddingId).limit(15);
  query = /^\d{1,6}$/.test(term) ? query.eq("token_number", Number(term)) : query.ilike("name", `%${term.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({ id: f.id, name: f.name, token: f.token_number as number | null }));
}

export function requireAccess(a: LedgerAccess, need: keyof LedgerAccess) {
  if (!a[need]) throw new AppError("FORBIDDEN");
}
