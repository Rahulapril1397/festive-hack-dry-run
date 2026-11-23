/**
 * Client-side idempotent action: a new key per user press, the SAME key on retry.
 * A network failure or 5xx keeps the key (the server may have applied it); any definitive
 * answer (2xx or 4xx) clears it so the next press is a new action.
 */
export type Sender<T> = (key: string) => Promise<{ status: number; body: T }>;

export type IdempotentAction<T> = {
  /** A new press. Reuses the pending key if the previous attempt was inconclusive. */
  press: () => Promise<{ status: number; body: T }>;
  pendingKey: () => string | null;
};

export function createIdempotentAction<T>(
  send: Sender<T>,
  newKey: () => string = () => crypto.randomUUID(),
  opts: { retries?: number; delayMs?: number } = {},
): IdempotentAction<T> {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 400;
  let pending: string | null = null;
  let inFlight: Promise<{ status: number; body: T }> | null = null;

  async function attempt(key: string) {
    let lastErr: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await send(key);
        if (res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}`);
        } else {
          pending = null; // definitive
          return res;
        }
      } catch (e) {
        lastErr = e;
      }
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
    throw lastErr; // key stays pending: the next press retries the same action
  }

  return {
    press() {
      // Double-tap while a request is in flight: return the same promise, do not send again.
      if (inFlight) return inFlight;
      pending ??= newKey();
      inFlight = attempt(pending).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    pendingKey: () => pending,
  };
}
