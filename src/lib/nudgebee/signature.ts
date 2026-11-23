import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature: header `x-nudgebee-signature: sha256=<hex HMAC-SHA256(NUDGEBEE_WEBHOOK_SECRET, raw body)>`
 * plus `x-nudgebee-timestamp` (ms) inside a 5-minute window, signed as `<timestamp>.<body>`.
 * NOTE: NudgeBee's own webhook format is not yet confirmed (doc_e2_s1 Day 0–1); adapt here only.
 */
export const SIGNATURE_HEADER = "x-nudgebee-signature";
export const TIMESTAMP_HEADER = "x-nudgebee-timestamp";
export const MAX_SKEW_MS = 5 * 60_000;

export function signPayload(secret: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(
  secret: string,
  header: string | null,
  timestamp: string | null,
  body: string,
  now = Date.now(),
): boolean {
  if (!secret || !header || !timestamp || !/^\d{13}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const got = Buffer.from(header.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}
