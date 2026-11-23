/**
 * Signed family cookie: value = `<link_key>.<base64url HMAC-SHA256(secret, link_key)>`.
 * Web Crypto only, so it runs in middleware and in route handlers.
 */
export const GUEST_COOKIE = "pa_family";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 120; // 120 days

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isLinkKeyShape = (k: string) => /^[A-Za-z0-9_-]{8,64}$/.test(k);

export async function signGuestCookie(linkKey: string, secret: string): Promise<string> {
  return `${linkKey}.${await hmac(secret, linkKey)}`;
}

export async function verifyGuestCookie(value: string | undefined, secret: string): Promise<string | null> {
  if (!value || !secret) return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const key = value.slice(0, i);
  if (!isLinkKeyShape(key)) return null;
  const expected = await hmac(secret, key);
  const got = value.slice(i + 1);
  if (expected.length !== got.length) return null;
  let diff = 0;
  for (let j = 0; j < expected.length; j++) diff |= expected.charCodeAt(j) ^ got.charCodeAt(j);
  return diff === 0 ? key : null;
}
