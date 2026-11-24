import { isAppLanguage, type AppLanguage } from "@/lib/sarvam/languages";

/** Best enabled app language from an Accept-Language header (q-weighted), or null. */
export function fromAcceptLanguage(header: string | null | undefined): AppLanguage | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: (tag ?? "").toLowerCase().split("-")[0]!, q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return (ranked.find((x) => isAppLanguage(x.lang))?.lang as AppLanguage | undefined) ?? null;
}

/**
 * Banner logic: suggest only when the family never chose a language, has not dismissed the hint,
 * and the suggestion differs from what they see now.
 */
export function shouldSuggest(f: { language: AppLanguage; languageSource: string; hintDismissed: boolean }, suggestion: AppLanguage | null): AppLanguage | null {
  if (!suggestion || f.hintDismissed || f.languageSource !== "default" || suggestion === f.language) return null;
  return suggestion;
}
