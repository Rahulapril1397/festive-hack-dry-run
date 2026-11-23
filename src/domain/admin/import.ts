/** Family CSV import: validation is pure (unit-tested); the database step is in service.ts. */
import { normalizePhone } from "@/domain/checkin/phone";
import { parseCsv } from "./csv";

export const MAX_IMPORT_ROWS = 2000;
export type ValidRow = { row: number; name: string; phone: string | null; language: "en" | "hi"; headcountMax: number | null };
export type RowError = { row: number; name: string; phone: string | null; error: string };

const LANG: Record<string, "en" | "hi"> = { "": "en", en: "en", english: "en", hi: "hi", hindi: "hi", "हिन्दी": "hi", "हिंदी": "hi" };

export function validateImport(text: string): { valid: ValidRow[]; errors: RowError[]; fatal?: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { valid: [], errors: [], fatal: "The file is empty" };
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (n: string) => header.indexOf(n);
  const iName = col("name");
  if (iName === -1) return { valid: [], errors: [], fatal: "Missing a 'name' column (expected: name, phone, language, headcount_max)" };
  const iPhone = col("phone");
  const iLang = col("language");
  const iMax = col("headcount_max");
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) return { valid: [], errors: [], fatal: `At most ${MAX_IMPORT_ROWS} rows per import` };

  const valid: ValidRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  body.forEach((cells, i) => {
    const row = i + 2; // 1-based, after the header
    const get = (idx: number) => (idx === -1 ? "" : (cells[idx] ?? "").trim());
    const name = get(iName);
    const rawPhone = get(iPhone);
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const fail = (error: string) => errors.push({ row, name, phone: phone ?? (rawPhone || null), error });
    if (name.length < 2 || name.length > 80) return fail("Name must be 2–80 characters");
    if (rawPhone && !phone) return fail("Phone is not a valid 10-digit Indian mobile number");
    if (phone && seen.has(phone)) return fail(`Same phone as row ${seen.get(phone)}`);
    const lang = LANG[get(iLang).toLowerCase()];
    if (!lang) return fail("Language must be en or hi");
    const rawMax = get(iMax);
    const headcountMax = rawMax === "" ? null : Number(rawMax);
    if (headcountMax !== null && (!Number.isInteger(headcountMax) || headcountMax < 0 || headcountMax > 20)) return fail("headcount_max must be a whole number 0–20");
    if (phone) seen.set(phone, row);
    valid.push({ row, name, phone, language: lang, headcountMax });
  });
  return { valid, errors };
}
