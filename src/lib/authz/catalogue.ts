/**
 * Permission catalogue and role keys — the names only. Which role has which permission lives in
 * Postgres (role_permission, migration 0010_rbac.sql) and is edited through the admin APIs.
 */
export const PERMISSIONS = [
  "queue.read", "queue.call_next", "queue.manage", "queue.skip", "queue.checkin",
  "clock.read",
  "host.read",
  "families.read", "families.write",
  "event.write",
  "rsvp.read", "rsvp.manage",
  "photos.upload", "photos.review",
  "kitchen.read", "kitchen.write",
  "ledger.read", "ledger.write", "ledger.export",
  "users.manage", "roles.manage", "weddings.manage", "audit.read",
  "ops.approve", "integrations.read",
  "assistant.use",
  // Stage 3
  "jobs.manage",
  "tasks.read", "tasks.manage", "tasks.update_own",
  "gifts.manage", "thanks.manage",
  "vendors.contacts.read", "vendors.manage", "vendors.commercial.read", "vendors.commercial.write", "vendors.documents.read",
  // Planning: rooms, drivers, arrivals; a vendor's own bookings
  "planning.read", "planning.write", "vendor.portal",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = ["super_admin", "admin", "host", "coordinator", "stage_manager", "finance", "kitchen", "photographer"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];
/** Any role key, system or custom. */
export type Role = string;

/** Order used to pick the "primary" role shown in the UI and passed to Flagsmith overrides. */
export function primaryRole(roles: readonly string[]): string {
  const ranked = [...roles].sort((a, b) => rank(a) - rank(b));
  return ranked[0] ?? "";
}
const rank = (r: string) => {
  const i = (SYSTEM_ROLES as readonly string[]).indexOf(r);
  return i === -1 ? SYSTEM_ROLES.length : i;
};

export const isPermission = (s: string): s is Permission => (PERMISSIONS as readonly string[]).includes(s);

/** "ledger.read" → "ledger" — for the admin role editor. */
export function permissionsByModule(keys: readonly string[] = PERMISSIONS): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of keys) (out[k.split(".")[0]!] ??= []).push(k);
  return out;
}
