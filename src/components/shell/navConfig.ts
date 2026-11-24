import type { Permission } from "@/lib/authz/catalogue";

/** Left nav for the minimal demo: photo flow, RSVP, four static tiles, admin and integrations. `soon` items render <ComingSoon />. */
export type NavItem = { key: string; label: string; href: string; permission: Permission; also?: Permission[]; soon?: boolean };

export const NAV: readonly NavItem[] = [
  { key: "overview", label: "Overview", href: "/host", permission: "host.read" },
  { key: "functions", label: "Functions", href: "/host/functions", permission: "host.read" },
  { key: "planning", label: "Planning", href: "/host/planning", permission: "planning.read" },
  { key: "rooms", label: "Rooms", href: "/host/rooms", permission: "planning.read" },
  { key: "transport", label: "Transport", href: "/host/transport", permission: "planning.read" },
  { key: "families", label: "Families and RSVP", href: "/host/families", permission: "rsvp.read" },
  { key: "kitchen", label: "Kitchen", href: "/kitchen", permission: "kitchen.write" },
  { key: "stage", label: "Stage and Queue", href: "/stage", permission: "queue.read" },
  { key: "photographer", label: "Photographer", href: "/photographer", permission: "photos.upload" },
  { key: "review", label: "Photo review", href: "/photographer/review", permission: "photos.review" },
  { key: "album", label: "Album", href: "/host/album", permission: "photos.review" },
  // Static demo tiles (fixed data, see src/lib/demo/staticTiles.ts). The real vendor, task and ledger screens stay unlinked.
  { key: "vendor-portal", label: "My bookings", href: "/vendor", permission: "vendor.portal" },
  { key: "vendors", label: "Vendors", href: "/demo/vendors", permission: "vendors.contacts.read", also: ["vendors.manage", "vendors.commercial.read"] },
  { key: "readiness", label: "Event readiness", href: "/demo/readiness", permission: "tasks.read", also: ["host.read"] },
  { key: "tasks", label: "Tasks", href: "/demo/tasks", permission: "tasks.read" },
  { key: "ledger", label: "Gift ledger", href: "/demo/ledger", permission: "ledger.read", also: ["ledger.write"] },
  { key: "users", label: "Users and Roles", href: "/admin", permission: "users.manage" },
  { key: "integrations", label: "Integrations", href: "/ops/integrations", permission: "integrations.read" },
  { key: "ops", label: "Ops recommendations", href: "/ops/recommendations", permission: "ops.approve" },
];

/** Nav for a permission set (from Postgres). The server still enforces every page and API. */
export function navFor(permissions: ReadonlySet<string>): NavItem[] {
  return NAV.filter((i) => permissions.has(i.permission) || (i.also ?? []).some((p) => permissions.has(p)));
}

const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin",
  admin: "/admin",
  host: "/host",
  coordinator: "/host",
  stage_manager: "/stage",
  kitchen: "/kitchen",
  photographer: "/photographer",
  finance: "/demo/ledger",
};

/** Home for the primary role; a custom role lands on its first nav item. */
export function homeFor(role: string, permissions?: ReadonlySet<string>): string {
  if (ROLE_HOME[role]) return ROLE_HOME[role];
  const first = permissions ? navFor(permissions)[0] : undefined;
  return first?.href ?? "/no-access";
}

export const SOON_FEATURES: Record<string, string> = {
  budget: "Budget",
};
