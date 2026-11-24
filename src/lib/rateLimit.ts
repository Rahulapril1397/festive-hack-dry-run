/**
 * Small in-memory sliding-window limiter (per pod). It stops one caller from running up Sarvam
 * costs through PinkyBua; it is not a distributed limit, so with 2 pods the effective ceiling is
 * about twice `max`. Returns true when the call is allowed.
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

/** Test helper. */
export const resetRateLimit = () => hits.clear();
