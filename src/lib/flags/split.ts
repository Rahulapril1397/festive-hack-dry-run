import { flagClient, type FlagClient } from "./client";
import { logFallback } from "./index";

/** Flagsmith flag holding the share of guests (0–100) placed in language group B. */
export const LANGUAGE_SPLIT_FLAG = "pinkybua_languages";
export const DEFAULT_LANGUAGE_SPLIT = 50;

/**
 * Share of new families placed in group B. Flag value "50" = 50%. Flag switched OFF = 0 (group B
 * closed). Flag missing, unreadable or Flagsmith down = 50. Only this one number comes from
 * Flagsmith; no guest identifier is ever sent there.
 */
export async function languageSplitPct(client: FlagClient = flagClient()): Promise<number> {
  try {
    const f = (await client.environmentFlags())[LANGUAGE_SPLIT_FLAG];
    if (!f) return DEFAULT_LANGUAGE_SPLIT;
    if (!f.enabled) return 0;
    const n = Number(f.value);
    return f.value !== null && f.value !== "" && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_LANGUAGE_SPLIT;
  } catch (e) {
    logFallback(LANGUAGE_SPLIT_FLAG, e);
    return DEFAULT_LANGUAGE_SPLIT;
  }
}
