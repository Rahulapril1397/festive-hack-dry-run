import { describe, expect, it } from "vitest";
import { CommercialInput, PaymentInput, UploadInput, VendorInput } from "@/contracts/vendors";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/authz/staticMap";

const cat = "00000000-0000-4000-8000-000000000001";

describe("vendor form validation (same schema client + server)", () => {
  it("accepts a normal vendor and normalises phones", () => {
    const v = VendorInput.parse({ categoryId: cat, name: "Sharma Caterers", contacts: [{ name: "Raju", phone: "+91 98765-43210", email: "" }] });
    expect(v.contacts![0]!.phone).toBe("+919876543210");
  });
  it("rejects bad phone, email, website and missing category", () => {
    const r = VendorInput.safeParse({ categoryId: "", name: "X", website: "sharma.com", contacts: [{ name: "Raju", phone: "123", email: "nope" }] });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["categoryId", "name", "website", "contacts.0.phone", "contacts.0.email"]));
  });
  it("money and uploads are bounded", () => {
    expect(CommercialInput.parse({ contractAmount: "250000" }).contractAmount).toBe(250000);
    expect(PaymentInput.safeParse({ kind: "advance", amount: 0 }).success).toBe(false);
    expect(UploadInput.safeParse({ fileName: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10 }).success).toBe(false);
    expect(UploadInput.safeParse({ fileName: "c.pdf", contentType: "application/pdf", sizeBytes: 21 * 1024 * 1024 }).success).toBe(false);
  });
});

describe("vendor permission defaults (fixture = migration 0210)", () => {
  const has = (r: keyof typeof DEFAULT_ROLE_PERMISSIONS, k: string) => (DEFAULT_ROLE_PERMISSIONS[r] as readonly string[]).includes(k);
  it("coordinator: contacts only; finance: money + documents, cannot edit vendors", () => {
    expect(has("coordinator", "vendors.contacts.read")).toBe(true);
    expect(has("coordinator", "vendors.commercial.read")).toBe(false);
    expect(has("finance", "vendors.commercial.write")).toBe(true);
    expect(has("finance", "vendors.documents.read")).toBe(true);
    expect(has("finance", "vendors.manage")).toBe(false);
    for (const r of ["stage_manager", "kitchen", "photographer"] as const) expect(DEFAULT_ROLE_PERMISSIONS[r].some((k) => k.startsWith("vendors."))).toBe(false);
  });
});
