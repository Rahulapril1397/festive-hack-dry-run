/**
 * Allowlisted Flagsmith overrides, called by requirePermission AFTER the baseline decision.
 *  - Overrides can only GRANT, never revoke.
 *  - Only roles in FLAG_OVERRIDE_ROLES (max two) ever reach Flagsmith.
 *  - Any timeout / outage / invalid response → the baseline decision, logged flag_fallback=true.
 */
import { flagClient, type FlagClient } from "./client";
import { logFallback } from "./index";
import type { FlagName } from "./defaults";

/** permission → the flag that may grant it */
export const OVERRIDE_GRANTS: Partial<Record<string, FlagName>> = {
  "queue.skip": "queue_skip_override",
};

const ROLE_ALIASES: Record<string, string> = { stage: "stage_manager" }; // Stage 1 name
export const MAX_OVERRIDE_ROLES = 2;

export function allowlistedRoles(raw = process.env.FLAG_OVERRIDE_ROLES ?? "stage_manager"): string[] {
  const roles = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => ROLE_ALIASES[r] ?? r);
  if (roles.length > MAX_OVERRIDE_ROLES) {
    console.warn(`FLAG_OVERRIDE_ROLES has ${roles.length} roles; only the first ${MAX_OVERRIDE_ROLES} are used`);
  }
  return [...new Set(roles)].slice(0, MAX_OVERRIDE_ROLES);
}

export type OverrideCtx = { userId: string; role: string; weddingId: string };
export type FlagEval = { weddingId: string; role: string; flag: string; permission: string; result: boolean; fallback: boolean };

export async function applyOverrides(
  ctx: OverrideCtx,
  key: string,
  baseDecision: boolean,
  deps: { client?: FlagClient; roles?: string[]; onEval?: (e: FlagEval) => void } = {},
): Promise<boolean> {
  if (baseDecision) return true;
  const flag = OVERRIDE_GRANTS[key];
  if (!flag) return false;
  const roles = deps.roles ?? allowlistedRoles();
  if (!roles.includes(ctx.role)) return false; // non-allowlisted roles never call Flagsmith
  try {
    const client = deps.client ?? flagClient();
    // Identity per (wedding, role): no user data leaves the app.
    const flags = await client.identityFlags(`wedding:${ctx.weddingId}:role:${ctx.role}`, { role: ctx.role });
    const f = flags[flag];
    if (!f || typeof f.enabled !== "boolean") {
      logFallback(flag, "missing flag");
      deps.onEval?.({ weddingId: ctx.weddingId, role: ctx.role, flag, permission: key, result: baseDecision, fallback: true });
      return baseDecision;
    }
    deps.onEval?.({ weddingId: ctx.weddingId, role: ctx.role, flag, permission: key, result: f.enabled, fallback: false });
    return f.enabled;
  } catch (e) {
    logFallback(flag, e);
    deps.onEval?.({ weddingId: ctx.weddingId, role: ctx.role, flag, permission: key, result: baseDecision, fallback: true });
    return baseDecision;
  }
}
