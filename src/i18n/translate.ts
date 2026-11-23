/**
 * Resolve translations for a set of English source strings: cached rows first, then Sarvam
 * for the misses (stored on success). Any failure leaves that string in English. Never throws.
 */
export type TranslateDeps = {
  loadCached: (sources: string[]) => Promise<Record<string, string>>;
  translate: (text: string) => Promise<string>;
  store: (rows: { source: string; text: string }[]) => Promise<void>;
  concurrency?: number;
};

export async function resolveTranslations(sources: string[], deps: TranslateDeps): Promise<Record<string, string>> {
  const unique = [...new Set(sources.filter((s) => s.trim()))];
  const out: Record<string, string> = Object.fromEntries(unique.map((s) => [s, s]));
  let cached: Record<string, string> = {};
  try {
    cached = await deps.loadCached(unique);
  } catch {
    cached = {};
  }
  Object.assign(out, cached);
  const missing = unique.filter((s) => !(s in cached));
  const fresh: { source: string; text: string }[] = [];
  const limit = Math.max(1, deps.concurrency ?? 6);
  for (let i = 0; i < missing.length; i += limit) {
    await Promise.all(
      missing.slice(i, i + limit).map(async (s) => {
        try {
          const t = await deps.translate(s);
          if (t && t.trim()) {
            out[s] = t;
            fresh.push({ source: s, text: t });
          }
        } catch {
          // keep English
        }
      }),
    );
  }
  if (fresh.length) await deps.store(fresh).catch(() => {});
  return out;
}
