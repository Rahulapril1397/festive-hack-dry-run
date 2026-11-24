import { createHash } from "node:crypto";
import type { LanguageGroup } from "@/lib/sarvam/languages";

/**
 * Stable A/B placement for the guest language test. The same family always lands in the same
 * group for a given split; the result is saved on the family record, so changing the split later
 * affects only families that have not opened their link yet. splitPct = share placed in group B.
 */
export function groupFor(familyId: string, splitPct: number): LanguageGroup {
  const pct = Number.isFinite(splitPct) ? Math.min(100, Math.max(0, Math.round(splitPct))) : 50;
  const bucket = createHash("sha256").update(`pinkybua_languages:${familyId}`).digest().readUInt32BE(0) % 100;
  return bucket < pct ? "B" : "A";
}
