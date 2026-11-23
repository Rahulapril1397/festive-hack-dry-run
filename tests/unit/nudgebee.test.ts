import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/lib/nudgebee/signature";

describe("NudgeBee webhook signature", () => {
  const secret = "nb-secret";
  const body = '{"text":"x","proposed_action":"voice_calls_off"}';
  const now = 1_767_225_600_000;
  const ts = String(now);

  it("accepts a correct signature", () => {
    expect(verifySignature(secret, signPayload(secret, ts, body), ts, body, now)).toBe(true);
  });
  it("rejects bad signature, wrong secret, altered body, missing headers", () => {
    expect(verifySignature(secret, "sha256=" + "0".repeat(64), ts, body, now)).toBe(false);
    expect(verifySignature(secret, signPayload("other", ts, body), ts, body, now)).toBe(false);
    expect(verifySignature(secret, signPayload(secret, ts, body), ts, body + " ", now)).toBe(false);
    expect(verifySignature(secret, null, ts, body, now)).toBe(false);
    expect(verifySignature("", signPayload("", ts, body), ts, body, now)).toBe(false);
  });
  it("rejects stale timestamps (replay)", () => {
    expect(verifySignature(secret, signPayload(secret, ts, body), ts, body, now + 5 * 60_000 + 1)).toBe(false);
  });
});
