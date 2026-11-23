/** Pure ledger rules: summary maths, amount redaction, CSV. No I/O. */
export const PAYMENT_METHODS = ["cash", "upi", "boxed_gift"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type LedgerRow = {
  id: string;
  created_at: string;
  event_id: string | null;
  event_name?: string | null;
  family_id: string | null;
  effective_family_id: string | null;
  family_name?: string | null;
  token_reference: string | null;
  gift_type: string;
  payment_method: PaymentMethod;
  amount: number | string | null;
  notes: string | null;
  reverses_id: string | null;
  is_reversal: boolean;
  is_reversed: boolean;
  reconciled_at: string | null;
};

export type LedgerSummary = {
  entries: number; // live (not reversed, not a reversal)
  cashTotal: number; // rupees, net of reversals
  upiTotal: number;
  boxedGifts: number;
  unmatchedEnvelopes: number; // live entries with no family (by entry or reconciliation)
};

const paise = (a: number | string | null) => (a == null ? 0 : Math.round(Number(a) * 100));
const live = (r: LedgerRow) => !r.is_reversal && !r.is_reversed;

export function summarize(rows: LedgerRow[]): LedgerSummary {
  let cash = 0;
  let upi = 0;
  for (const r of rows) {
    if (r.payment_method === "cash") cash += paise(r.amount);
    if (r.payment_method === "upi") upi += paise(r.amount);
  }
  const liveRows = rows.filter(live);
  return {
    entries: liveRows.length,
    cashTotal: cash / 100,
    upiTotal: upi / 100,
    boxedGifts: liveRows.filter((r) => r.payment_method === "boxed_gift").length,
    unmatchedEnvelopes: liveRows.filter((r) => !r.effective_family_id).length,
  };
}

export type ApiLedgerRow = Omit<LedgerRow, "amount"> & { amount?: number | null; status: "active" | "reversed" | "reversal"; reconciled: boolean };

/** Without ledger.read the `amount` key is removed entirely, not nulled. */
export function toApiRow(r: LedgerRow, canReadAmounts: boolean): ApiLedgerRow {
  const { amount, ...rest } = r;
  const base = {
    ...rest,
    status: r.is_reversal ? ("reversal" as const) : r.is_reversed ? ("reversed" as const) : ("active" as const),
    reconciled: !!r.effective_family_id,
  };
  return canReadAmounts ? { ...base, amount: amount == null ? null : Number(amount) } : base;
}

/** CSV with formula-injection guard (= + - @ tab CR prefixed with '). */
export function toCsv(rows: LedgerRow[]): string {
  const header = ["created_at", "function", "family", "token_reference", "gift_type", "payment_method", "amount", "notes", "status", "reconciled"];
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const a = toApiRow(r, true);
    return [r.created_at, r.event_name, r.family_name, r.token_reference, r.gift_type, r.payment_method, a.amount == null ? "" : a.amount.toFixed(2), r.notes, a.status, a.reconciled ? "yes" : "no"]
      .map(cell)
      .join(",");
  });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
