/**
 * Warm the translation cache so the first Hindi guest doesn't wait on Sarvam: translates every
 * static UI string (src/i18n/en.json) plus each wedding's invitation text into the enabled
 * languages and stores them in the `translation` table (never names, phones or amounts).
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SARVAM_API_KEY=… npx tsx scripts/pregen-translations.ts [--wedding=<uuid>] [--langs=hi,ta,…]  (default: all nine non-English languages)
 */
import { createClient } from "@supabase/supabase-js";
import en from "../src/i18n/en.json";
import { createSarvamClient } from "../src/lib/sarvam/client";
import { ENABLED_LANGUAGES, type AppLanguage } from "../src/lib/sarvam/languages";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const must = (k: string) => process.env[k] || (console.error(`${k} is required`), process.exit(1));
const langs = arg("langs", ENABLED_LANGUAGES.filter((l) => l !== "en").join(",")).split(",").filter((l) => l !== "en") as AppLanguage[];

const supa = createClient(must("SUPABASE_URL") as string, must("SUPABASE_SERVICE_ROLE_KEY") as string, { auth: { persistSession: false } });
const sarvam = createSarvamClient({ apiKey: must("SARVAM_API_KEY") as string, apiUrl: process.env.SARVAM_API_URL || undefined, timeoutMs: 15_000, allowMock: false });

/** Sarvam rate-limits bursts (HTTP 429): retry with a growing pause. */
async function translateWithRetry(source: string, lang: AppLanguage): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sarvam.translate(source, lang);
    } catch (e) {
      if (attempt >= 5 || !/429/.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function main() {
  const only = arg("wedding", "");
  const { data: weddings } = await (only ? supa.from("wedding").select("id, invitation_text").eq("id", only) : supa.from("wedding").select("id, invitation_text"));
  let made = 0, skipped = 0, failed = 0;
  for (const w of weddings ?? []) {
    const sources = [...new Set([...Object.values(en), ...(w.invitation_text ? [w.invitation_text as string] : [])])];
    for (const lang of langs) {
      const { data: have } = await supa.from("translation").select("source_text").eq("wedding_id", w.id).eq("language", lang);
      const done = new Set((have ?? []).map((r) => r.source_text));
      const todo = sources.filter((s) => !done.has(s));
      skipped += sources.length - todo.length;
      for (let i = 0; i < todo.length; i += 2) {
        await new Promise((r) => setTimeout(r, 400));
        await Promise.all(todo.slice(i, i + 2).map(async (source) => {
          try {
            const text = await translateWithRetry(source, lang);
            const { error } = await supa.from("translation").upsert({ wedding_id: w.id, language: lang, source_text: source, text }, { onConflict: "wedding_id,language,source_text", ignoreDuplicates: true });
            if (error) throw error;
            made++;
          } catch (e) {
            failed++;
            console.error(`${lang}: ${source.slice(0, 40)}… ${(e as Error).message}`);
          }
        }));
      }
    }
  }
  console.log(`translations: ${made} made, ${skipped} already cached, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
