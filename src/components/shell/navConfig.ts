import { roleHas, type Permission, type Role } from "@/lib/authz/staticMap";

/** Left nav per the Host wireframe, plus role homes. `soon` items render <ComingSoon />. */
export type NavItem = { key: string; label: string; href: string; permission: Permission; soon?: boolean };

export const NAV: readonly NavItem[] = [
  { key: "overview", label: "Overview", href: "/host", permission: "host.read" },
  { key: "functions", label: "Functions", href: "/host/functions", permission: "host.read" },
  { key: "families", label: "Families and RSVP", href: "/host/families", permission: "family.read" },
  { key: "kitchen", label: "Kitchen", href: "/kitchen", permission: "kitchen.read" },
  { key: "stage", label: "Stage and Queue", href: "/stage", permission: "queue.read" },
  { key: "photographer", label: "Photographer", href: "/photographer", permission: "photos.upload" },
  { key: "review", label: "Photo review", href: "/photographer/review", permission: "photos.review" },
  { key: "album", label: "Album", href: "/host/album", permission: "photos.review" },
  { key: "ledger", label: "Shagun Ledger", href: "/ledger", permission: "ledger.write" },
  { key: "thank-yous", label: "Thank-yous", href: "/soon/thank-yous", permission: "host.read", soon: true },
  { key: "vendors", label: "Vendors", href: "/soon/vendors", permission: "host.read", soon: true },
  { key: "tasks", label: "Tasks", href: "/soon/tasks", permission: "host.read", soon: true },
  { key: "users", label: "Users and Roles", href: "/admin", permission: "users.manage" },
  { key: "ops", label: "Ops recommendations", href: "/ops/recommendations", permission: "ops.approve" },
];

/** Ledger is shown to anyone who can read OR write it; amounts are still gated server-side. */
export function navFor(role: Role | string): NavItem[] {
  return NAV.filter((i) => roleHas(role, i.permission) || (i.key === "ledger" && roleHas(role, "ledger.read")));
}

export const ROLE_HOME: Record<Role, string> = {
  host: "/host",
  stage: "/stage",
  kitchen: "/kitchen",
  photographer: "/photographer",
  admin: "/admin",
  finance: "/ledger",
};

export const homeFor = (role: string) => ROLE_HOME[role as Role] ?? "/stage";

export const SOON_FEATURES: Record<string, string> = {
  "thank-yous": "Thank-you notes",
  vendors: "Vendors",
  tasks: "Tasks",
  budget: "Budget",
};
