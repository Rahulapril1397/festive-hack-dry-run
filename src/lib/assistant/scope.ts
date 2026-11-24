import type { Session } from "@/lib/authz";
import { allowedFor, type ToolDef } from "./tools";

/**
 * Demo scope for PinkyBua: one topic per audience. The full tool registry stays in
 * tools/index.ts; widening access later means adding a name here (and switching the role on),
 * with every permission check still applied.
 *   staff (admin, super admin): photo counts per function
 *   guest (family link):        the family's own RSVP
 */
export const DEMO_SCOPE: Record<"staff" | "guest", readonly string[]> = {
  staff: ["photo_review_counts"],
  guest: ["my_rsvp"],
};

export const inScope = (kind: "staff" | "guest", toolName: string) => DEMO_SCOPE[kind].includes(toolName);

/** Tools the model may see: allowed by permission AND inside the demo scope. */
export function scopedTools(kind: "staff" | "guest", permissions: ReadonlySet<string>): ToolDef[] {
  return allowedFor(kind, permissions).filter((t) => inScope(kind, t.name));
}

/** PinkyBua is active for admin and super admin only; every other staff role sees it greyed out. */
export const staffActive = (s: Pick<Session, "isSuperAdmin" | "roles">) => s.isSuperAdmin || s.roles.includes("admin");
