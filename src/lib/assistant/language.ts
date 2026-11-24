import type { AppLanguage } from "@/lib/sarvam/languages";

/** Script → language, for telling which language a person wrote or spoke (pure; also used by tests). */
const SCRIPTS: { lang: AppLanguage; re: RegExp }[] = [
  { lang: "hi", re: /[ऀ-ॿ]/g },
  { lang: "bn", re: /[ঀ-৿]/g },
  { lang: "pa", re: /[਀-੿]/g },
  { lang: "gu", re: /[઀-૿]/g },
  { lang: "ta", re: /[஀-௿]/g },
  { lang: "te", re: /[ఀ-౿]/g },
  { lang: "kn", re: /[ಀ-೿]/g },
  { lang: "ml", re: /[ഀ-ൿ]/g },
  { lang: "en", re: /[A-Za-z]/g },
];

/**
 * The language of `text` by its dominant script, or null when it has no letters. Devanagari is
 * Hindi, or Marathi when `hint` is Marathi (the two share a script). Latin letters mean English.
 */
export function detectLanguage(text: string, hint?: AppLanguage): AppLanguage | null {
  let best: AppLanguage | null = null;
  let max = 0;
  for (const { lang, re } of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (n > max) {
      max = n;
      best = lang;
    }
  }
  return best === "hi" && hint === "mr" ? "mr" : best;
}
