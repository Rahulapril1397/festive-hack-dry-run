import { createHash, randomBytes } from "node:crypto";

/** Canonical JSON (sorted keys) so the same args always hash the same. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const argsHash = (args: unknown) => sha256(canonical(args));
export const newConfirmToken = () => randomBytes(32).toString("base64url");
