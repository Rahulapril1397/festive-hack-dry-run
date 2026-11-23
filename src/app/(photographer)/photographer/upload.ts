/** Upload helpers (pure enough to unit-test): bounded parallelism and per-item retries. */
export async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i]!);
    }
  });
  await Promise.all(runners);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let last: unknown;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn(a);
    } catch (e) {
      last = e;
      if (a < attempts) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (a - 1)));
    }
  }
  throw last;
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
