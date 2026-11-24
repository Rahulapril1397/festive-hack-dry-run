/**
 * Thank-you templates (pure, unit-tested). Placeholders: {family} {gift} {couple}.
 * Translation never sees names: placeholders are swapped for numbered tokens before the text goes
 * to Sarvam and swapped back after; if a token is lost the note falls back to English.
 */
import { createHash } from "node:crypto";

export const PLACEHOLDERS = ["family", "gift", "couple"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateVars = Partial<Record<Placeholder, string | null>>;

export const DEFAULT_TEMPLATES = {
  A: "Dear {family}, thank you for being part of our wedding and for your blessings. {gift}With love, {couple}",
  B: "Dear {family}, your presence made our celebration complete. We will always remember it. {gift}Warmly, {couple}",
} as const;
export type Variant = keyof typeof DEFAULT_TEMPLATES;

/** Stable A/B split by family id (same family → same variant, ~50/50 overall). */
export function variantFor(familyId: string): Variant {
  return createHash("sha256").update(familyId).digest()[0]! % 2 === 0 ? "A" : "B";
}

/** Unknown {words} are left as typed; missing values collapse with their surrounding space. */
export function render(body: string, vars: TemplateVars): string {
  return body
    .replace(/\{(family|gift|couple)\}/g, (_, k: Placeholder) => vars[k] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .trim();
}

/** "{gift}" renders as a sentence about the gift when there is one. */
export const giftSentence = (title: string | null | undefined) => (title ? `Thank you also for the ${title}. ` : "");

const TOKEN = (i: number) => `{${i}}`;

/** Replace placeholders with {0},{1}… for translation. */
export function protect(body: string): { text: string; order: Placeholder[] } {
  const order: Placeholder[] = [];
  const text = body.replace(/\{(family|gift|couple)\}/g, (_, k: Placeholder) => {
    order.push(k);
    return TOKEN(order.length - 1);
  });
  return { text, order };
}

/** Back to placeholders; null if the translation lost or duplicated a token. */
export function restore(translated: string, order: Placeholder[]): string | null {
  for (let i = 0; i < order.length; i++) if (translated.split(TOKEN(i)).length !== 2) return null;
  return translated.replace(/\{(\d+)\}/g, (m, i: string) => (order[Number(i)] ? `{${order[Number(i)]}}` : m));
}
