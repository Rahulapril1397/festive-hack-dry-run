import { z } from "zod";
import { PERMISSIONS } from "@/lib/authz/catalogue";

/**
 * Admin API contract (Stage 2, E1 → E3 admin UI). All routes under /api/admin, all
 * server-authorised and audited. Errors: { error: { code, message } } with codes FORBIDDEN (403),
 * NOT_FOUND (404), BAD_REQUEST (400), ROLE_EXISTS / SYSTEM_ROLE / LAST_SUPER_ADMIN (409).
 *
 * GET    /api/admin/users?scope=wedding|all       → { users: AdminUser[] }            users.manage (all: super admin)
 * POST   /api/admin/users                         InviteUserInput → InviteResult      users.manage
 * POST   /api/admin/users/:id/suspend | reactivate → { user: AdminUser }              users.manage
 * POST   /api/admin/assignments                   CreateAssignmentInput → Assignment  users.manage in that wedding
 * DELETE /api/admin/assignments/:id               → { ok: true }                      users.manage in that wedding
 * GET    /api/admin/roles                         → { roles: AdminRole[], permissions: string[] }  users.manage
 * POST   /api/admin/roles                         CreateRoleInput → AdminRole         roles.manage
 * PUT    /api/admin/roles/:id/permissions         { permissionKeys } → AdminRole      roles.manage
 * GET    /api/admin/audit?actor&action&from&to&cursor&limit&scope → AuditPage         audit.read
 * POST   /api/admin/weddings                      CreateWeddingInput → { weddingId, events } weddings.manage
 * POST   /api/admin/families/import?weddingId     CSV body (text/csv) or multipart "file" → ImportResult (Accept: text/csv → CSV)  families.write
 * POST   /api/admin/families/:id/rotate-link      → { familyId, link }                families.write
 */

export const PermissionKey = z.enum(PERMISSIONS);

export const Assignment = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  weddingId: z.string().uuid().nullable(),
  weddingName: z.string().nullable(),
  roleId: z.string().uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  startsAt: z.string(),
  expiresAt: z.string().nullable(),
  active: z.boolean(),
});
export type Assignment = z.infer<typeof Assignment>;

export const AdminUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(["active", "suspended"]),
  lastActiveAt: z.string().nullable(),
  invitedAt: z.string().nullable(),
  assignments: z.array(Assignment),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminRole = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
});
export type AdminRole = z.infer<typeof AdminRole>;

export const InviteUserInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(80).optional(),
  /** optional first assignment in the caller's selected wedding (or weddingId) */
  roleId: z.string().uuid().optional(),
  weddingId: z.string().uuid().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export const InviteResult = z.object({
  user: AdminUser,
  /** "email" when Supabase sent the invite; "link" when the admin must share inviteLink themselves */
  delivery: z.enum(["email", "link", "existing"]),
  inviteLink: z.string().url().optional(),
});
export type InviteResult = z.infer<typeof InviteResult>;

export const CreateAssignmentInput = z
  .object({
    userId: z.string().uuid(),
    weddingId: z.string().uuid().nullable(),
    roleId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .refine((a) => !a.expiresAt || !a.startsAt || new Date(a.expiresAt) > new Date(a.startsAt), { message: "Expiry must be after start", path: ["expiresAt"] });

export const CreateRoleInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/, "lowercase letters, digits and _ (3–40)"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  permissionKeys: z.array(PermissionKey).max(PERMISSIONS.length),
});
export const SetRolePermissionsInput = z.object({ permissionKeys: z.array(PermissionKey).max(PERMISSIONS.length) });

export const AuditQuery = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  scope: z.enum(["wedding", "all"]).default("wedding"),
});
export const AuditEntry = z.object({
  id: z.number(),
  at: z.string(),
  weddingId: z.string().nullable(),
  actor: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entity: z.string().nullable(),
  details: z.record(z.unknown()),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditPage = z.object({ entries: z.array(AuditEntry), nextCursor: z.number().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

export const CreateWeddingInput = z.object({
  wedding: z.object({
    name: z.string().trim().min(2).max(120),
    coupleNames: z.string().trim().max(120).optional(),
    weddingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    contactPhone: z.string().trim().max(30).optional(),
    invitationText: z.string().trim().max(1000).optional(),
  }),
  events: z.array(z.object({ name: z.string().trim().min(2).max(60), startsAt: z.string().datetime({ offset: true }).optional(), language: z.enum(["en", "hi"]).default("en") })).min(1).max(20),
  /** host: an existing user id, or an email to invite */
  hostUserId: z.string().uuid().optional(),
  hostEmail: z.string().trim().toLowerCase().email().optional(),
});

export const ImportRowResult = z.object({
  row: z.number(),
  name: z.string(),
  phone: z.string().nullable(),
  status: z.enum(["created", "error"]),
  error: z.string().nullable(),
  link: z.string().nullable(),
  code: z.string().nullable(),
  tokenStatus: z.string().nullable(),
});
export type ImportRowResult = z.infer<typeof ImportRowResult>;
export const ImportResult = z.object({
  summary: z.object({ rows: z.number(), created: z.number(), errors: z.number() }),
  rows: z.array(ImportRowResult),
  csv: z.string(),
});
export type ImportResult = z.infer<typeof ImportResult>;
