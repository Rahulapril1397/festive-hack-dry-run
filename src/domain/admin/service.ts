import "server-only";
import { randomInt } from "node:crypto";
import type { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import type { Session } from "@/lib/authz";
import { familyLink } from "@/domain/checkin/service";
import type {
  AdminRole,
  AdminUser,
  Assignment,
  AuditPage,
  AuditQuery,
  CreateAssignmentInput,
  CreateRoleInput,
  CreateWeddingInput,
  ImportResult,
  ImportRowResult,
  InviteResult,
  InviteUserInput,
} from "@/contracts/admin";
import { toCsv } from "./csv";
import { validateImport } from "./import";

const BAN_FOREVER = "876000h"; // ~100 years

type URow = { id: string; user_id: string; wedding_id: string | null; starts_at: string; expires_at: string | null; role: { id: string; key: string; name: string } | null; wedding: { name: string } | null };

function toAssignment(r: URow): Assignment {
  const now = Date.now();
  return {
    id: r.id,
    userId: r.user_id,
    weddingId: r.wedding_id,
    weddingName: r.wedding?.name ?? null,
    roleId: r.role!.id,
    roleKey: r.role!.key,
    roleName: r.role!.name,
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    active: new Date(r.starts_at).getTime() <= now && (!r.expires_at || new Date(r.expires_at).getTime() > now),
  };
}

const ASSIGNMENT_SELECT = "id, user_id, wedding_id, starts_at, expires_at, role:role_id(id, key, name), wedding:wedding_id(name)";

/** Users with any assignment in the wedding (scope=wedding), or every user (scope=all, super admin). */
export async function listUsers(s: Session, scope: "wedding" | "all"): Promise<AdminUser[]> {
  let userIds: string[] | null = null;
  if (scope === "wedding") {
    const { data } = await db().from("user_role").select("user_id").eq("wedding_id", s.weddingId);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
    if (!userIds.length) return [];
  }
  let q = db().from("app_user").select("id, email, display_name, status, last_seen_at, invited_at").order("email");
  if (userIds) q = q.in("id", userIds);
  const { data: users, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (users ?? []).map((u) => u.id as string);
  const { data: rows } = ids.length ? await db().from("user_role").select(ASSIGNMENT_SELECT).in("user_id", ids) : { data: [] };
  const byUser = new Map<string, Assignment[]>();
  for (const r of (rows ?? []) as unknown as URow[]) {
    if (scope === "wedding" && r.wedding_id !== s.weddingId && r.role?.key !== "super_admin") continue;
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), toAssignment(r)]);
  }
  return (users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.display_name,
    status: u.status,
    lastActiveAt: u.last_seen_at,
    invitedAt: u.invited_at,
    assignments: byUser.get(u.id) ?? [],
  }));
}

async function getUser(s: Session, id: string): Promise<AdminUser> {
  const all = await listUsers(s, "all");
  const u = all.find((x) => x.id === id);
  if (!u) throw new AppError("NOT_FOUND");
  return { ...u, assignments: s.isSuperAdmin ? u.assignments : u.assignments.filter((a) => a.weddingId === s.weddingId) };
}

async function findAuthUserByEmail(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** Invite by email (Supabase sends it); if sending fails, generate a link the admin can share. */
export async function inviteUser(s: Session, input: z.infer<typeof InviteUserInput>): Promise<InviteResult> {
  const redirectTo = `${env().APP_URL}/login/accept`;
  let userId: string;
  let delivery: InviteResult["delivery"] = "email";
  let inviteLink: string | undefined;

  const existing = await findAuthUserByEmail(input.email);
  if (existing) {
    userId = existing.id;
    delivery = "existing";
  } else {
    const sent = await db().auth.admin.inviteUserByEmail(input.email, { redirectTo, data: { name: input.name ?? null } });
    if (!sent.error && sent.data.user) {
      userId = sent.data.user.id;
    } else {
      log("WARNING", "invite email not sent; generating a link", { code: sent.error?.code ?? null });
      const gen = await db().auth.admin.generateLink({ type: "invite", email: input.email, options: { redirectTo } });
      if (gen.error || !gen.data.user) throw new AppError("BAD_REQUEST", "Could not invite this email");
      userId = gen.data.user.id;
      delivery = "link";
      inviteLink = gen.data.properties.action_link;
    }
  }
  await rpc("admin_upsert_user", { p_actor: s.userId, p_wedding: s.weddingId || null, p_user: userId, p_email: input.email, p_name: input.name ?? null });
  if (input.roleId) {
    await assign(s, { userId, weddingId: input.weddingId ?? s.weddingId, roleId: input.roleId, expiresAt: input.expiresAt ?? null });
  }
  return { user: await getUser(s, userId), delivery, inviteLink };
}

/** Admins may only act on users that have a role in their wedding; super admins on anyone. */
async function assertManageable(s: Session, userId: string) {
  if (userId === s.userId) throw new AppError("BAD_REQUEST", "You cannot change your own account");
  if (s.isSuperAdmin) return;
  const { data } = await db().from("user_role").select("id").eq("user_id", userId).eq("wedding_id", s.weddingId).limit(1);
  if (!data?.length) throw new AppError("NOT_FOUND");
}

export async function setUserStatus(s: Session, userId: string, status: "active" | "suspended"): Promise<AdminUser> {
  await assertManageable(s, userId);
  await rpc("admin_set_user_status", { p_actor: s.userId, p_wedding: s.weddingId || null, p_user: userId, p_status: status });
  // Also stop new sign-ins / token refresh. Postgres status already denies every request.
  const { error } = await db().auth.admin.updateUserById(userId, { ban_duration: status === "suspended" ? BAN_FOREVER : "none" });
  if (error) log("WARNING", "auth ban update failed", { code: error.code ?? null, status });
  return getUser(s, userId);
}

export async function assign(s: Session, input: z.infer<typeof CreateAssignmentInput>): Promise<Assignment> {
  const { data: role } = await db().from("role").select("id, key").eq("id", input.roleId).maybeSingle();
  if (!role) throw new AppError("NOT_FOUND");
  if (role.key === "super_admin" || input.weddingId === null) {
    if (!s.isSuperAdmin) throw new AppError("FORBIDDEN", "Only a super admin can grant super admin");
  }
  const row = await rpc<{ id: string }>("admin_assign", {
    p_actor: s.userId,
    p_user: input.userId,
    p_wedding: role.key === "super_admin" ? null : input.weddingId,
    p_role: input.roleId,
    p_starts: input.startsAt ?? null,
    p_expires: input.expiresAt ?? null,
  });
  const { data } = await db().from("user_role").select(ASSIGNMENT_SELECT).eq("id", row.id).single();
  return toAssignment(data as unknown as URow);
}

export async function assignmentWedding(id: string): Promise<{ weddingId: string | null; roleKey: string }> {
  const { data } = await db().from("user_role").select("wedding_id, role:role_id(key)").eq("id", id).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND");
  return { weddingId: data.wedding_id, roleKey: (data.role as unknown as { key: string }).key };
}

export async function unassign(s: Session, id: string) {
  await rpc("admin_unassign", { p_actor: s.userId, p_assignment: id });
}

export async function listRoles(): Promise<AdminRole[]> {
  const { data, error } = await db().from("role").select("id, key, name, description, is_system, role_permission(permission_key)").order("is_system", { ascending: false }).order("key");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    permissions: ((r.role_permission ?? []) as { permission_key: string }[]).map((p) => p.permission_key).sort(),
  }));
}

export async function createRole(s: Session, input: z.infer<typeof CreateRoleInput>): Promise<AdminRole> {
  const r = await rpc<{ id: string }>("admin_create_role", { p_actor: s.userId, p_key: input.key, p_name: input.name, p_description: input.description ?? null, p_permissions: input.permissionKeys });
  return (await listRoles()).find((x) => x.id === r.id)!;
}

export async function setRolePermissions(s: Session, roleId: string, keys: string[]): Promise<AdminRole> {
  await rpc("admin_set_role_permissions", { p_actor: s.userId, p_role: roleId, p_permissions: keys });
  const role = (await listRoles()).find((x) => x.id === roleId);
  if (!role) throw new AppError("NOT_FOUND");
  return role;
}

export async function auditPage(s: Session, q: z.infer<typeof AuditQuery>): Promise<AuditPage> {
  let query = db().from("audit_log").select("id, wedding_id, actor, action, target, data, created_at").order("id", { ascending: false }).limit(q.limit + 1);
  if (q.scope === "wedding" || !s.isSuperAdmin) query = query.eq("wedding_id", s.weddingId);
  if (q.actor) query = query.eq("actor", q.actor);
  if (q.action) query = query.ilike("action", `${q.action.replace(/[%_]/g, "")}%`);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lt("created_at", q.to);
  if (q.cursor) query = query.lt("id", q.cursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const page = rows.slice(0, q.limit);
  const actors = [...new Set(page.map((r) => r.actor).filter(Boolean))] as string[];
  const { data: users } = actors.length ? await db().from("app_user").select("id, email").in("id", actors) : { data: [] };
  const emailOf = new Map((users ?? []).map((u) => [u.id as string, u.email as string]));
  return {
    entries: page.map((r) => ({
      id: Number(r.id),
      at: r.created_at,
      weddingId: r.wedding_id,
      actor: r.actor,
      actorEmail: r.actor ? (emailOf.get(r.actor) ?? null) : null,
      action: r.action,
      entity: r.target,
      details: (r.data ?? {}) as Record<string, unknown>,
    })),
    nextCursor: rows.length > q.limit ? Number(page[page.length - 1]!.id) : null,
  };
}

export async function createWedding(s: Session, input: z.infer<typeof CreateWeddingInput>) {
  let host = input.hostUserId ?? null;
  if (!host && input.hostEmail) {
    const inv = await inviteUser(s, { email: input.hostEmail });
    host = inv.user.id;
  }
  return rpc<{ weddingId: string; events: { id: string; name: string }[] }>("admin_create_wedding", {
    p_actor: s.userId,
    p_wedding: input.wedding,
    p_events: input.events,
    p_host_user: host,
  });
}

const TOKEN_STATUS = "not assigned yet (given at first check-in)";
const CSV_HEADER = ["row", "name", "phone", "status", "error", "link", "code", "token_status"];

/** Validate per row, import the good rows in one transaction, report every row. */
export async function importFamilies(s: Session, weddingId: string, text: string): Promise<ImportResult> {
  const { valid, errors, fatal } = validateImport(text);
  if (fatal) throw new AppError("BAD_REQUEST", fatal);
  const codes = new Map(valid.map((v) => [v.row, String(randomInt(1000, 10000))]));
  const results = valid.length
    ? await rpc<{ row: number; status: "created" | "error"; familyId?: string; linkKey?: string; error?: string }[]>("families_import", {
        p_actor: s.userId,
        p_wedding: weddingId,
        p_rows: valid.map((v) => ({ row: v.row, name: v.name, phone: v.phone, language: v.language, headcountMax: v.headcountMax, code: codes.get(v.row) })),
      })
    : [];
  const byRow = new Map(results.map((r) => [r.row, r]));
  const rows: ImportRowResult[] = [
    ...valid.map((v) => {
      const r = byRow.get(v.row);
      const ok = r?.status === "created";
      return {
        row: v.row,
        name: v.name,
        phone: v.phone,
        status: ok ? ("created" as const) : ("error" as const),
        error: ok ? null : (r?.error ?? "Not imported"),
        link: ok && r?.linkKey ? familyLink(r.linkKey) : null,
        code: ok ? codes.get(v.row)! : null,
        tokenStatus: ok ? TOKEN_STATUS : null,
      };
    }),
    ...errors.map((e) => ({ row: e.row, name: e.name, phone: e.phone, status: "error" as const, error: e.error, link: null, code: null, tokenStatus: null })),
  ].sort((a, b) => a.row - b.row);
  const created = rows.filter((r) => r.status === "created").length;
  return {
    summary: { rows: rows.length, created, errors: rows.length - created },
    rows,
    csv: toCsv(CSV_HEADER, rows.map((r) => [r.row, r.name, r.phone, r.status, r.error, r.link, r.code, r.tokenStatus])),
  };
}

export async function rotateLink(s: Session, weddingId: string, familyId: string) {
  const key = await rpc<string>("family_rotate_link", { p_actor: s.userId, p_wedding: weddingId, p_family: familyId });
  return { familyId, link: familyLink(key) };
}
