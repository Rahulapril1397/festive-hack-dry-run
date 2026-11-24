import { isAppLanguage, type AppLanguage } from "@/lib/sarvam/languages";

/** Best app language from an Accept-Language header (q-weighted), among `allowed` when given, or null. */
export function fromAcceptLanguage(header: string | null | undefined, allowed?: readonly AppLanguage[]): AppLanguage | null {
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
  return (ranked.find((x) => isAppLanguage(x.lang) && (!allowed || allowed.includes(x.lang)))?.lang as AppLanguage | undefined) ?? null;
}
