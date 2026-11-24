/**
 * TEST FIXTURE ONLY (Stage 2). Runtime permissions come from Postgres (authz.effective_permissions).
 * This must equal the defaults seeded by supabase/migrations/0010_rbac.sql (+ Stage 3: 0020, 0022, 0120, 0121, 0210, 0124) —
 * tests/integration/rbac.test.ts compares the two, and unit tests use it as the expected matrix.
 */
import { PERMISSIONS, type Permission, type SystemRole } from "./catalogue";

const ALL = [...PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  super_admin: ALL,
  admin: ALL.filter((p) => p !== "roles.manage" && p !== "weddings.manage"),
  host: ["host.read", "queue.read", "queue.checkin", "families.read", "families.write", "event.write", "rsvp.read", "rsvp.manage", "photos.review", "kitchen.read", "ledger.read", "integrations.read", "assistant.use",
    "tasks.read", "tasks.manage", "tasks.update_own", "gifts.manage", "thanks.manage",
    "vendors.contacts.read", "vendors.manage", "vendors.commercial.read", "vendors.commercial.write", "vendors.documents.read", "planning.read", "planning.write"],
  coordinator: ["host.read", "queue.read", "queue.checkin", "families.read", "rsvp.read", "rsvp.manage", "photos.review", "kitchen.read", "assistant.use",
    "tasks.read", "tasks.manage", "tasks.update_own", "gifts.manage", "vendors.contacts.read", "planning.read"],
  stage_manager: ["queue.read", "queue.call_next", "queue.manage", "queue.checkin", "clock.read", "assistant.use", "tasks.read", "tasks.update_own"],
  kitchen: ["kitchen.read", "kitchen.write", "assistant.use", "tasks.read", "tasks.update_own"],
  photographer: ["clock.read", "photos.upload", "photos.review", "assistant.use", "tasks.read", "tasks.update_own"],
  finance: ["ledger.read", "ledger.write", "ledger.export", "families.read", "assistant.use", "tasks.read", "tasks.update_own",
    "vendors.contacts.read", "vendors.commercial.read", "vendors.commercial.write", "vendors.documents.read"],
};

/** Fixture lookup for tests. */
export function roleHas(role: string, key: string): boolean {
  const perms = (DEFAULT_ROLE_PERMISSIONS as Record<string, readonly string[]>)[role];
  return !!perms && perms.includes(key);
}

export { PERMISSIONS, type Permission } from "./catalogue";
export { SYSTEM_ROLES as ROLES } from "./catalogue";
