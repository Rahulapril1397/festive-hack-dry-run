import "server-only";
import en from "./en.json";
import { db } from "@/lib/db/service";
import { sarvam } from "@/lib/sarvam/client";
import type { AppLanguage } from "@/lib/sarvam/languages";
import { resolveTranslations } from "./translate";

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;
export const EN: Dictionary = en;

/**
 * Contract C5. `const t = await getT(lang, weddingId, extra)` then `t("rsvp.save")`.
 * English is the source. Other languages: translation table, else Sarvam (cached), else English.
 * `extra` = approved copy (e.g. the invitation text); never names, phones or amounts.
 */
export async function getT(lang: AppLanguage, weddingId: string, extra: string[] = []) {
  const sources = [...Object.values(EN), ...extra];
  const map =
    lang === "en"
      ? Object.fromEntries(sources.map((s) => [s, s]))
      : await resolveTranslations(sources, {
          loadCached: async (src) => {
            const { data, error } = await db()
              .from("translation")
              .select("source_text, text")
              .eq("wedding_id", weddingId)
              .eq("language", lang)
              .in("source_text", src);
            if (error) throw error;
            return Object.fromEntries((data ?? []).map((r) => [r.source_text, r.text]));
          },
          translate: (s) => sarvam().translate(s, lang),
          store: async (rows) => {
            await db()
              .from("translation")
              .upsert(rows.map((r) => ({ wedding_id: weddingId, language: lang, source_text: r.source, text: r.text })), {
                onConflict: "wedding_id,language,source_text",
                ignoreDuplicates: true,
              });
          },
        });
  const t = (key: MessageKey) => map[EN[key]] ?? EN[key];
  t.text = (source: string) => map[source] ?? source;
  t.dict = () => Object.fromEntries((Object.keys(EN) as MessageKey[]).map((k) => [k, t(k)])) as Dictionary;
  return t;
}
