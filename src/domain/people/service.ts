import "server-only";
import type { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import type { Session } from "@/lib/authz";
import { inviteUser } from "@/domain/admin/service";
import type { AssignInput, EditRoleInput, HistoryEntry, ParticipantInput, ParticipantPatch, Person, PersonAssignment, WeddingRole } from "@/contracts/people";

/**
 * People (Stage 3 E1 T2–T3): participants may exist without a login; their assignments stay
 * "pending" until invited and linked. Callers have checked users.manage in s.weddingId.
 */

type PRow = {
  id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  title: string | null;
  status: "active" | "inactive";
  user: { id: string; email: string | null; status: string; last_seen_at: string | null } | null;
  user_role: {
    id: string;
    status: PersonAssignment["status"];
    starts_at: string;
    expires_at: string | null;
    role: { id: string; key: string; name: string } | null;
    user_permission_override: { permission_key: string }[];
  }[];
};
const SELECT =
  "id, display_name, phone, email, title, status, user:user_id(id, email, status, last_seen_at), user_role(id, status, starts_at, expires_at, role:role_id(id, key, name), user_permission_override(permission_key))";

function toPerson(r: PRow): Person {
  const now = Date.now();
  return {
    id: r.id,
    displayName: r.display_name,
    phone: r.phone,
    email: r.email,
    title: r.title,
    status: r.status,
    user: r.user ? { id: r.user.id, email: r.user.email, status: r.user.status, lastSeenAt: r.user.last_seen_at } : null,
    assignments: (r.user_role ?? [])
      .filter((a) => a.role)
      .map((a) => ({
        id: a.id,
        roleId: a.role!.id,
        roleKey: a.role!.key,
        roleName: a.role!.name,
        status: a.status,
        startsAt: a.starts_at,
        expiresAt: a.expires_at,
        effective: a.status === "active" && r.user?.status === "active" && new Date(a.starts_at).getTime() <= now && (!a.expires_at || new Date(a.expires_at).getTime() > now),
        denied: (a.user_permission_override ?? []).map((o) => o.permission_key).sort(),
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

export async function listPeople(weddingId: string): Promise<Person[]> {
  const { data, error } = await db().from("participant").select(SELECT).eq("wedding_id", weddingId).order("display_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PRow[]).map(toPerson);
}

export async function getPerson(weddingId: string, id: string): Promise<Person> {
  const { data, error } = await db().from("participant").select(SELECT).eq("wedding_id", weddingId).eq("id", id).maybeSingle();
  if (error?.code === "22P02" || (!error && !data)) throw new AppError("NOT_FOUND");
  if (error) throw new Error(error.message);
  return toPerson(data as unknown as PRow);
}

export async function upsertPerson(s: Session, id: string | null, input: z.infer<typeof ParticipantInput> | z.infer<typeof ParticipantPatch>): Promise<Person> {
  const row = await rpc<{ id: string }>("people_upsert", { p_actor: s.userId, p_wedding: s.weddingId, p_id: id, p: input });
  return getPerson(s.weddingId, row.id);
}

/** Invite the participant's email to sign in (Supabase), then link the login: pending → active. */
export async function invitePerson(s: Session, id: string) {
  const person = await getPerson(s.weddingId, id);
  if (person.user) throw new AppError("BAD_REQUEST", "This person already has a login");
  if (!person.email) throw new AppError("BAD_REQUEST", "Add an email address first");
  const r = await inviteUser(s, { email: person.email, name: person.displayName });
  await rpc("people_link_user", { p_actor: s.userId, p_wedding: s.weddingId, p_participant: id, p_user: r.user.id });
  return { person: await getPerson(s.weddingId, id), delivery: r.delivery, inviteLink: r.inviteLink };
}

async function roleUsable(weddingId: string, roleId: string) {
  const { data } = await db().from("role").select("id, key, wedding_id").eq("id", roleId).maybeSingle();
  if (!data || data.key === "super_admin" || (data.wedding_id && data.wedding_id !== weddingId)) throw new AppError("NOT_FOUND", "Role not found");
}

export async function assignPerson(s: Session, id: string, input: z.infer<typeof AssignInput>): Promise<Person> {
  await roleUsable(s.weddingId, input.roleId);
  await rpc("people_assign", { p_actor: s.userId, p_wedding: s.weddingId, p_participant: id, p_role: input.roleId, p_starts: input.startsAt ?? null, p_expires: input.expiresAt ?? null });
  return getPerson(s.weddingId, id);
}

/** The participant an assignment belongs to, checked against the caller's wedding. */
async function assignmentOwner(s: Session, assignmentId: string): Promise<string> {
  const { data } = await db().from("user_role").select("participant_id, wedding_id, user_id").eq("id", assignmentId).maybeSingle();
  if (!data || data.wedding_id !== s.weddingId || !data.participant_id) throw new AppError("NOT_FOUND");
  if (data.user_id === s.userId) throw new AppError("BAD_REQUEST", "You cannot change your own access");
  return data.participant_id as string;
}

export async function setAssignmentStatus(s: Session, assignmentId: string, status: "active" | "suspended"): Promise<Person> {
  const pid = await assignmentOwner(s, assignmentId);
  await rpc("assignment_set_status", { p_actor: s.userId, p_assignment: assignmentId, p_status: status });
  return getPerson(s.weddingId, pid);
}

export async function setOverride(s: Session, assignmentId: string, key: string, deny: boolean): Promise<Person> {
  const pid = await assignmentOwner(s, assignmentId);
  await rpc("assignment_set_override", { p_actor: s.userId, p_assignment: assignmentId, p_key: key, p_deny: deny });
  return getPerson(s.weddingId, pid);
}

type RRow = { id: string; key: string; name: string; description: string | null; is_system: boolean; wedding_id: string | null; cloned_from: string | null; role_permission: { permission_key: string }[] };

/** System templates (minus super_admin) and this wedding's custom roles. */
export async function listWeddingRoles(weddingId: string): Promise<WeddingRole[]> {
  const { data, error } = await db()
    .from("role")
    .select("id, key, name, description, is_system, wedding_id, cloned_from, role_permission(permission_key)")
    .or(`wedding_id.is.null,wedding_id.eq.${weddingId}`)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as RRow[])
    .filter((r) => r.key !== "super_admin")
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      custom: r.wedding_id === weddingId,
      clonedFrom: r.cloned_from,
      permissions: (r.role_permission ?? []).map((p) => p.permission_key).sort(),
    }));
}

export async function cloneRole(s: Session, sourceRoleId: string, name: string): Promise<WeddingRole> {
  await roleUsable(s.weddingId, sourceRoleId);
  const r = await rpc<{ id: string }>("role_clone", { p_actor: s.userId, p_wedding: s.weddingId, p_source: sourceRoleId, p_name: name });
  return (await listWeddingRoles(s.weddingId)).find((x) => x.id === r.id)!;
}

/** A custom role may only hold permissions the editor has (no privilege escalation by role editing). */
export async function editWeddingRole(s: Session, roleId: string, input: z.infer<typeof EditRoleInput>): Promise<WeddingRole> {
  if (!s.isSuperAdmin) {
    const extra = input.permissionKeys.filter((k) => !s.permissions.has(k));
    if (extra.length) throw new AppError("FORBIDDEN", `You cannot grant permissions you don't have: ${extra.join(", ")}`);
  }
  await rpc("role_set_wedding_permissions", { p_actor: s.userId, p_wedding: s.weddingId, p_role: roleId, p_name: input.name ?? null, p_permissions: input.permissionKeys });
  const role = (await listWeddingRoles(s.weddingId)).find((x) => x.id === roleId);
  if (!role) throw new AppError("NOT_FOUND");
  return role;
}

/** Assignment history from the audit log (who changed what, when). */
export async function personHistory(weddingId: string, id: string): Promise<HistoryEntry[]> {
  const person = await getPerson(weddingId, id);
  const targets = [id, ...person.assignments.map((a) => a.id), ...(person.user ? [person.user.id] : [])];
  const { data, error } = await db()
    .from("audit_log")
    .select("id, action, actor, data, created_at")
    .in("target", targets)
    .or(`wedding_id.eq.${weddingId},wedding_id.is.null`)
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const actors = [...new Set((data ?? []).map((r) => r.actor).filter(Boolean))] as string[];
  const { data: users } = actors.length ? await db().from("app_user").select("id, email").in("id", actors) : { data: [] };
  const email = new Map((users ?? []).map((u) => [u.id as string, u.email as string]));
  return (data ?? []).map((r) => ({ id: r.id, action: r.action, actor: r.actor, actorEmail: r.actor ? (email.get(r.actor) ?? null) : null, createdAt: r.created_at, data: r.data ?? {} }));
}

/** Participant id for a login in a wedding (task ownership, "my tasks"). */
export async function participantFor(weddingId: string, userId: string): Promise<string | null> {
  const { data } = await db().from("participant").select("id").eq("wedding_id", weddingId).eq("user_id", userId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
