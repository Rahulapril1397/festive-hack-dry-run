/**
 * Stage 1 role → permission map. Stage 2 moves this into role_permission (Postgres) and
 * swaps the implementation of requirePermission; callers do not change.
 *
 * TODO(spec §3.3): reconcile the keys below with the spec's permission list. The four extra
 * keys from doc_e1_s1 (queue.checkin, photos.review, kitchen.read, ledger.write) are included.
 */
export const ROLES = ["host", "stage", "kitchen", "photographer", "admin", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "queue.read",        // see the stage console / waiting list (includes family names)
  "queue.call_next",   // CALL NEXT
  "queue.manage",      // pause, resume, on_stage, served, no_show
  "queue.skip",        // SKIP; stage gets it via the Flagsmith override queue_skip_override (E2)
  "queue.checkin",     // desk check-in, walk-ins, lookup
  "clock.read",        // clock QR (contract C4)
  "host.read",         // host command centre
  "family.read",
  "family.write",
  "event.write",       // create functions
  "rsvp.read",
  "rsvp.write",
  "photos.upload",
  "photos.review",
  "kitchen.read",
  "kitchen.write",     // meal status
  "ledger.read",       // amounts and totals
  "ledger.write",      // add / reverse / reconcile entries
  "ledger.export",     // CSV export
  "users.manage",      // admin screen
  "audit.read",
  "ops.approve",       // NudgeBee recommendations (E2)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const STATIC_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL,
  host: ["host.read", "queue.read", "queue.checkin", "family.read", "family.write", "event.write", "rsvp.read", "rsvp.write", "photos.review", "kitchen.read", "ledger.read"],
  stage: ["queue.read", "queue.call_next", "queue.manage", "queue.checkin", "clock.read", "family.read"],
  kitchen: ["kitchen.read", "kitchen.write"],
  photographer: ["clock.read", "photos.upload", "photos.review"],
  finance: ["ledger.read", "ledger.write", "ledger.export", "family.read"],
};

export function roleHas(role: string, key: string): boolean {
  if (!(ROLES as readonly string[]).includes(role)) return false;
  return (STATIC_ROLE_PERMISSIONS[role as Role] as readonly string[]).includes(key);
}
