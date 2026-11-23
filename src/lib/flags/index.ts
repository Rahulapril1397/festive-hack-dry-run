import { flagClient, type FlagClient } from "./client";
import { FLAG_FALLBACK, type FlagName } from "./defaults";

/** One log line per fallback, grep-able in Cloud Logging: flag_fallback=true */
export function logFallback(flag: string, reason: unknown) {
  console.warn(`flag_fallback=true flag=${flag} reason=${JSON.stringify(String(reason instanceof Error ? reason.message : reason))}`);
}

/** isEnabled(flag): 30-second cache; on any error returns the safe fallback. Never throws. */
export async function isEnabled(flag: FlagName, client: FlagClient = flagClient()): Promise<boolean> {
  try {
    const flags = await client.environmentFlags();
    const f = flags[flag];
    if (!f) return FLAG_FALLBACK[flag];
    return f.enabled;
  } catch (e) {
    logFallback(flag, e);
    return FLAG_FALLBACK[flag];
  }
}

export { FLAG_DEFAULTS, FLAG_FALLBACK, type FlagName } from "./defaults";
export { flagClient, createFlagClient } from "./client";
