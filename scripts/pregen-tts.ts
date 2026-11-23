/**
 * Pre-generate TV announcements into the private "tts" bucket so calls play instantly and survive
 * Sarvam hiccups.  Run as part of a prod release (costs one Sarvam TTS call per missing clip):
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SARVAM_API_KEY=… npx tsx scripts/pregen-tts.ts [--to=300] [--langs=en,hi]
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { announcementText } from "../src/lib/sarvam/announcement";
import { createSarvamClient } from "../src/lib/sarvam/client";
import type { AppLanguage } from "../src/lib/sarvam/languages";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const to = Number(arg("to", "300"));
const langs = arg("langs", "en,hi").split(",") as AppLanguage[];
const must = (k: string) => process.env[k] || (console.error(`${k} is required`), process.exit(1));

const supa = createClient(must("SUPABASE_URL") as string, must("SUPABASE_SERVICE_ROLE_KEY") as string, { auth: { persistSession: false } });
const sarvam = createSarvamClient({ apiKey: must("SARVAM_API_KEY") as string, apiUrl: process.env.SARVAM_API_URL || undefined, model: process.env.SARVAM_TTS_MODEL || undefined, speaker: process.env.SARVAM_SPEAKER || undefined, timeoutMs: 15_000, allowMock: false });
const path = (lang: string, text: string) => `${lang}/${createHash("sha256").update(text).digest("hex")}.wav`;

async function main() {
  let made = 0, skipped = 0, failed = 0;
  for (const lang of langs) {
    const { data: existing } = await supa.storage.from("tts").list(lang, { limit: 10000 });
    const have = new Set((existing ?? []).map((o) => `${lang}/${o.name}`));
    const todo = Array.from({ length: to }, (_, i) => i + 1).filter((t) => !have.has(path(lang, announcementText(t, lang))));
    skipped += to - todo.length;
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(async (token) => {
        const text = announcementText(token, lang);
        try {
          const audio = await sarvam.tts(text, lang);
          const { error } = await supa.storage.from("tts").upload(path(lang, text), audio.bytes, { contentType: audio.contentType, upsert: true });
          if (error) throw error;
          made++;
        } catch (e) {
          failed++;
          console.error(`${lang} token ${token}: ${(e as Error).message}`);
        }
      }));
      process.stdout.write(`\r${lang}: ${Math.min(i + 4, todo.length)}/${todo.length}`);
    }
    process.stdout.write("\n");
  }
  console.log(`generated ${made}, already present ${skipped}, failed ${failed}`);
  if (failed) process.exit(1);
}
main();
