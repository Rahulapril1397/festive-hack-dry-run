import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Knowledge base: one short file per role; only the caller's file is loaded. */
const DIR = join(process.cwd(), "src", "lib", "assistant", "kb");
const FALLBACK = "coordinator";
const cache = new Map<string, string>();

export function knowledgeFor(role: string): string {
  const key = /^[a-z_]+$/.test(role) ? role : FALLBACK;
  if (!cache.has(key)) {
    let text: string;
    try {
      text = readFileSync(join(DIR, `${key}.md`), "utf8");
    } catch {
      text = readFileSync(join(DIR, `${FALLBACK}.md`), "utf8");
    }
    cache.set(key, text);
  }
  return cache.get(key)!;
}

/** Sections whose heading or text mention the topic words (for explain_screen / faq). */
export function sectionsAbout(kb: string, topic: string): string {
  const sections = kb.split(/\n(?=## )/).slice(1);
  const words = topic.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const hits = sections.filter((s) => words.some((w) => s.toLowerCase().includes(w)));
  return (hits.length ? hits : sections).join("\n\n").slice(0, 4000);
}
