import type { E2ERole } from "./harness";

/** Visible nav per role with the default permission sets (0010_rbac.sql + Stage 3 migrations). */
export const EXPECTED_NAV: Record<E2ERole, string[]> = {
  super_admin: ["overview", "functions", "families", "kitchen", "stage", "photographer", "review", "album", "ledger", "tasks", "vendors", "gifts", "thank-yous", "people", "users", "jobs", "integrations", "ops"],
  admin: ["overview", "functions", "families", "kitchen", "stage", "photographer", "review", "album", "ledger", "tasks", "vendors", "gifts", "thank-yous", "people", "users", "jobs", "integrations", "ops"],
  host: ["overview", "functions", "families", "kitchen", "stage", "review", "album", "ledger", "tasks", "vendors", "gifts", "thank-yous", "integrations"],
  coordinator: ["overview", "functions", "families", "kitchen", "stage", "review", "album", "tasks", "vendors", "gifts"],
  stage_manager: ["stage", "tasks"],
  kitchen: ["kitchen", "tasks"],
  photographer: ["photographer", "review", "album", "tasks"],
  finance: ["families", "ledger", "tasks", "vendors"],
};

/** A page and an API each role must NOT reach (403 / access-denied). */
export const FORBIDDEN: Record<E2ERole, { page: string; api: [string, string] } | null> = {
  super_admin: null,
  admin: null,
  host: { page: "/admin", api: ["GET", "/api/admin/users"] },
  coordinator: { page: "/ledger", api: ["GET", "/api/ledger"] },
  stage_manager: { page: "/ledger", api: ["GET", "/api/ledger"] },
  kitchen: { page: "/host/families", api: ["GET", "/api/ledger"] },
  photographer: { page: "/kitchen", api: ["POST", "/api/queue/00000000-0000-4000-8000-0000000000a3/pause"] },
  finance: { page: "/stage", api: ["GET", "/api/queue/00000000-0000-4000-8000-0000000000a3"] },
};
