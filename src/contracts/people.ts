import { z } from "zod";
import { PERMISSIONS } from "@/lib/authz/catalogue";

/**
 * Stage 3 People API (E1 T2–T3). All routes need users.manage in the selected wedding.
 *
 * GET    /api/people                              → { people: Person[], roles: WeddingRole[] }
 * POST   /api/people                              ParticipantInput → Person
 * PATCH  /api/people/:id                          ParticipantPatch → Person
 * POST   /api/people/:id/invite                   → { person, delivery, inviteLink? }   (needs an email)
 * POST   /api/people/:id/assignments              AssignInput → Person
 * GET    /api/people/:id/history                  → { entries: HistoryEntry[] }
 * POST   /api/people/assignments/:id/status       { status: active|suspended } → Person
 * PUT    /api/people/assignments/:id/overrides    { permissionKey, deny } → Person
 * POST   /api/people/roles                        CloneRoleInput → WeddingRole
 * PUT    /api/people/roles/:id                    EditRoleInput → WeddingRole       (wedding roles only)
 */

const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[^\d+]/g, ""))
  .refine((s) => s === "" || /^\+?\d{10,13}$/.test(s), "10–13 digits");

export const ParticipantInput = z.object({
  displayName: z.string().trim().min(2).max(80),
  phone: phone.optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email()]).optional(),
  title: z.string().trim().max(80).optional(),
});
export const ParticipantPatch = ParticipantInput.partial().extend({ status: z.enum(["active", "inactive"]).optional() });

const iso = z.string().datetime({ offset: true });
export const AssignInput = z
  .object({ roleId: z.string().uuid(), startsAt: iso.nullish(), expiresAt: iso.nullish() })
  .refine((v) => !v.startsAt || !v.expiresAt || new Date(v.expiresAt) > new Date(v.startsAt), { message: "Expiry must be after the start", path: ["expiresAt"] });
export const AssignmentStatusInput = z.object({ status: z.enum(["active", "suspended"]) });
export const OverrideInput = z.object({ permissionKey: z.enum(PERMISSIONS), deny: z.boolean() });
export const CloneRoleInput = z.object({ sourceRoleId: z.string().uuid(), name: z.string().trim().min(2).max(60) });
export const EditRoleInput = z.object({ name: z.string().trim().min(2).max(60).optional(), permissionKeys: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) });

export type PersonAssignment = {
  id: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  status: "pending" | "active" | "suspended" | "expired";
  startsAt: string;
  expiresAt: string | null;
  /** active, in window, login active */
  effective: boolean;
  denied: string[];
};
export type Person = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  title: string | null;
  status: "active" | "inactive";
  user: { id: string; email: string | null; status: string; lastSeenAt: string | null } | null;
  assignments: PersonAssignment[];
};
export type WeddingRole = { id: string; key: string; name: string; description: string | null; isSystem: boolean; custom: boolean; clonedFrom: string | null; permissions: string[] };
export type HistoryEntry = { id: number; action: string; actor: string | null; actorEmail: string | null; createdAt: string; data: Record<string, unknown> };
