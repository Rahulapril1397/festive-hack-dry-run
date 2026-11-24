import { z } from "zod";

/**
 * Stage 3 Vendors API (E3). Route guard = any vendor permission; the domain re-checks the exact one.
 * GET    /api/vendors?q&categoryId&status&eventId          contacts.read | manage | commercial.read
 * POST   /api/vendors                       VendorInput → Vendor                 vendors.manage
 * GET    /api/vendors/duplicates?name&phone&exclude      → { matches }            vendors.manage
 * GET    /api/vendors/:id                   → VendorDetail (sections by permission)
 * PATCH  /api/vendors/:id                   VendorPatch                         vendors.manage
 * POST   /api/vendors/:id/status            { status }                           vendors.manage
 * PUT    /api/vendors/:id/events/:eventId   { scope?, arrivalAt? } / DELETE      vendors.manage
 * PUT    /api/vendors/:id/commercial        CommercialInput                     vendors.commercial.write
 * POST   /api/vendors/:id/payments          PaymentInput                        vendors.commercial.write
 * POST   /api/vendors/:id/notes             { body, restricted }                vendors.manage (restricted: commercial.write)
 * POST   /api/vendors/:id/documents/upload  { fileName, contentType, sizeBytes } → signed upload   vendors.manage
 * POST   /api/vendors/:id/documents         { kind, fileName, storagePath, contentType, sizeBytes } vendors.manage
 * GET    /api/vendors/documents/:docId      → 302 to a 5-minute signed URL      vendors.documents.read
 * DELETE /api/vendors/documents/:docId                                          vendors.manage
 */
const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[^\d+]/g, ""))
  .refine((s) => s === "" || /^\+?\d{10,13}$/.test(s), "Phone: 10–13 digits");

export const ContactInput = z.object({
  name: z.string().trim().min(1, "Contact name").max(80),
  role: z.string().trim().max(60).optional(),
  phone: phone.optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Email looks wrong")]).optional(),
  whatsapp: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});
export const VendorInput = z.object({
  categoryId: z.string().uuid("Pick a category"),
  name: z.string().trim().min(2, "Name: at least 2 characters").max(120),
  businessName: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  website: z.union([z.literal(""), z.string().trim().url("Website must be a full link").regex(/^https?:\/\//)]).optional(),
  services: z.string().trim().max(1000).optional(),
  contacts: z.array(ContactInput).max(10).optional(),
  force: z.boolean().optional(),
});
export const VendorPatch = VendorInput.partial();
export const AssignEventInput = z.object({ scope: z.string().trim().max(200).optional(), arrivalAt: z.union([z.literal(""), z.string().datetime({ offset: true })]).optional() });
const rupees = z.union([z.literal(""), z.coerce.number().min(0).max(100_000_000)]);
export const CommercialInput = z.object({
  quotedAmount: rupees.optional(),
  contractAmount: rupees.optional(),
  paymentTerms: z.string().trim().max(1000).optional(),
  contractStatus: z.enum(["none", "quoted", "negotiating", "signed", "completed", "cancelled"]).optional(),
});
export const PaymentInput = z.object({
  kind: z.enum(["advance", "payment", "refund"]),
  amount: z.coerce.number().positive().max(100_000_000),
  dueAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  paidAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  method: z.union([z.literal(""), z.enum(["cash", "upi", "bank", "cheque", "card", "other"])]).optional(),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional(),
});
export const NoteInput = z.object({ body: z.string().trim().min(1).max(4000), restricted: z.boolean().default(false) });
export const DOC_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export const UploadInput = z.object({ fileName: z.string().trim().min(1).max(200), contentType: z.enum(Object.keys(DOC_TYPES) as [keyof typeof DOC_TYPES]), sizeBytes: z.number().int().positive().max(20 * 1024 * 1024, "Up to 20 MB") });
export const DocumentInput = UploadInput.extend({ kind: z.enum(["contract", "quote", "invoice", "receipt", "id", "other"]), storagePath: z.string().max(300) });
export const VendorQuery = z.object({ q: z.string().max(100).optional(), categoryId: z.string().uuid().optional(), status: z.enum(["active", "inactive", "all"]).optional(), eventId: z.string().uuid().optional() });

export type VendorContact = { id: string; name: string; role: string | null; phone: string | null; email: string | null; whatsapp: boolean; isPrimary: boolean };
export type Vendor = {
  id: string;
  name: string;
  businessName: string | null;
  categoryId: string;
  categoryName: string;
  city: string | null;
  status: "active" | "inactive";
  primaryContact: VendorContact | null; // null without vendors.contacts.read
  events: { id: string; name: string; scope: string | null; arrivalAt: string | null }[];
  contractStatus?: string; // only with vendors.commercial.read
};
export type VendorDetail = Vendor & {
  website: string | null;
  services: string | null;
  contacts: VendorContact[] | null;
  notes: { id: string; body: string; restricted: boolean; createdAt: string; by: string | null }[];
  commercial: null | {
    quotedAmount: number | null;
    contractAmount: number | null;
    paymentTerms: string | null;
    contractStatus: string;
    paid: number;
    payments: { id: string; kind: string; amount: number; dueAt: string | null; paidAt: string | null; method: string | null; reference: string | null; note: string | null }[];
  };
  documents: null | { id: string; kind: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string }[];
  tasks: null | { id: string; title: string; status: string; dueAt: string | null }[];
  can: { manage: boolean; commercialRead: boolean; commercialWrite: boolean; documents: boolean; contacts: boolean };
};
export type VendorCategory = { id: string; key: string; name: string };
