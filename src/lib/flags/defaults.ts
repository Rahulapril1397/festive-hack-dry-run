/** Flags this app reads. Values used when Flagsmith is not configured (local/mock mode). */
export const FLAG_DEFAULTS = {
  voice_calls: true, // TTS announcements on the TV. Default ON.
  queue_skip_override: true, // grants queue.skip to allowlisted roles
} as const;
export type FlagName = keyof typeof FLAG_DEFAULTS;

/** Safe value when Flagsmith errors/times out (may differ from the local default). */
export const FLAG_FALLBACK: Record<FlagName, boolean> = {
  voice_calls: true, // keep announcing; the TV chimes anyway if TTS fails
  queue_skip_override: false, // never grant extra permissions on failure
};
