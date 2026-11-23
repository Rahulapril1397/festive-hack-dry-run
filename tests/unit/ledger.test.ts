import { describe, expect, it } from "vitest";
import { summarize, toApiRow, toCsv, type LedgerRow } from "@/domain/ledger/model";

let n = 0;
const row = (p: Partial<LedgerRow>): LedgerRow => ({
  id: `e${++n}`,
  created_at: "2026-12-13T14:00:00Z",
  event_id: null,
  family_id: "f1",
  effective_family_id: "f1",
  token_reference: null,
  gift_type: "shagun",
  payment_method: "cash",
  amount: 100,
  notes: null,
  reverses_id: null,
  is_reversal: false,
  is_reversed: false,
  reconciled_at: null,
  ...p,
});

describe("ledger summary", () => {
  it("totals cash and UPI, counts boxed gifts and unmatched envelopes", () => {
    const s = summarize([
      row({ amount: "5100.00" }),
      row({ payment_method: "upi", amount: 11000 }),
      row({ amount: 2100, family_id: null, effective_family_id: null }),
      row({ payment_method: "boxed_gift", amount: null }),
    ]);
    expect(s).toEqual({ entries: 4, cashTotal: 7200, upiTotal: 11000, boxedGifts: 1, unmatchedEnvelopes: 1 });
  });

  it("a reversing entry cancels the original; correction = reversal + new entry", () => {
    const orig = row({ id: "o", amount: 500, is_reversed: true });
    const rev = row({ id: "r", amount: -500, reverses_id: "o", is_reversal: true });
    const fixed = row({ amount: 5000 });
    expect(summarize([orig, rev, fixed])).toMatchObject({ entries: 1, cashTotal: 5000 });
  });

  it("no floating-point drift on paise", () => {
    expect(summarize([row({ amount: 0.1 }), row({ amount: 0.2 })]).cashTotal).toBe(0.3);
  });

  it("reconciliation makes an envelope matched", () => {
    expect(summarize([row({ family_id: null, effective_family_id: "f9" })]).unmatchedEnvelopes).toBe(0);
  });
});

describe("amount redaction", () => {
  it("without ledger.read the JSON has no amount field at all", () => {
    const r = toApiRow(row({ amount: 5100 }), false);
    expect("amount" in r).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/amount|5100/);
  });
  it("with ledger.read the amount is a number", () => {
    expect(toApiRow(row({ amount: "5100.00" }), true).amount).toBe(5100);
  });
});

describe("CSV export", () => {
  it("quotes, escapes and guards against formula injection", () => {
    const csv = toCsv([row({ notes: '=HYPERLINK("x")', family_name: "Rao, A", amount: 1100 })]);
    const [header, line] = csv.trim().split("\r\n");
    expect(header).toContain("amount");
    expect(line).toContain('"Rao, A"');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("1100.00");
  });
});
