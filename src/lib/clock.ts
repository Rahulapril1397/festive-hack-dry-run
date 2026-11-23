import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Contract C4 — signed server time for photographer clock calibration.
 * QR payload: `PA|<t_ms>|<sig>` where sig = hex HMAC-SHA256(secret, String(t_ms)).
 */
export function signTime(tMs: number, secret: string): string {
  return createHmac("sha256", secret).update(String(tMs)).digest("hex");
}

export function clockPayload(tMs: number, secret: string) {
  const sig = signTime(tMs, secret);
  return { t_ms: tMs, sig, qr: `PA|${tMs}|${sig}` };
}

/** For E3: verify a scanned payload. Returns t_ms or null. */
export function verifyClockQr(text: string, secret: string): number | null {
  const m = /^PA\|(\d{13})\|([0-9a-f]{64})$/.exec(text.trim());
  if (!m) return null;
  const t = Number(m[1]);
  const expected = Buffer.from(signTime(t, secret), "hex");
  const got = Buffer.from(m[2]!, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got) ? t : null;
}
