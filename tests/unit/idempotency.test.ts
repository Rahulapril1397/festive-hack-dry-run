import { describe, expect, it } from "vitest";
import { createIdempotentAction } from "@/domain/queue/idempotency";

function keys() {
  let n = 0;
  return () => `key-${++n}`;
}

describe("idempotent client action", () => {
  it("uses a new key for each successful press", async () => {
    const seen: string[] = [];
    const a = createIdempotentAction(async (k) => (seen.push(k), { status: 200, body: {} }), keys(), { delayMs: 1 });
    await a.press();
    await a.press();
    expect(seen).toEqual(["key-1", "key-2"]);
  });

  it("retries a network failure with the SAME key", async () => {
    const seen: string[] = [];
    let calls = 0;
    const a = createIdempotentAction(
      async (k) => {
        seen.push(k);
        if (++calls < 3) throw new Error("network");
        return { status: 200, body: {} };
      },
      keys(),
      { retries: 2, delayMs: 1 },
    );
    await a.press();
    expect(seen).toEqual(["key-1", "key-1", "key-1"]);
  });

  it("keeps the key after an inconclusive failure so the next press replays it", async () => {
    const seen: string[] = [];
    let fail = true;
    const a = createIdempotentAction(
      async (k) => {
        seen.push(k);
        if (fail) return { status: 503, body: {} };
        return { status: 200, body: {} };
      },
      keys(),
      { retries: 0, delayMs: 1 },
    );
    await expect(a.press()).rejects.toThrow();
    expect(a.pendingKey()).toBe("key-1");
    fail = false;
    await a.press();
    expect(seen).toEqual(["key-1", "key-1"]);
    expect(a.pendingKey()).toBeNull();
  });

  it("a 4xx is definitive: next press gets a new key", async () => {
    const seen: string[] = [];
    const a = createIdempotentAction(async (k) => (seen.push(k), { status: 409, body: {} }), keys(), { delayMs: 1 });
    await a.press();
    await a.press();
    expect(seen).toEqual(["key-1", "key-2"]);
  });

  it("a double tap while in flight sends once", async () => {
    let sends = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = createIdempotentAction(async () => {
      sends++;
      await gate;
      return { status: 200, body: {} };
    }, keys());
    const p1 = a.press();
    const p2 = a.press();
    release();
    await Promise.all([p1, p2]);
    expect(sends).toBe(1);
  });
});
