import { requirePage } from "@/components/shell/guard";
import { db } from "@/lib/db/service";
import { PERMISSIONS, ROLES, STATIC_ROLE_PERMISSIONS } from "@/lib/authz/staticMap";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const s = await requirePage("users.manage", "/admin");
  const [{ data: urs }, { data: wedding }, { data: audit }, authUsers] = await Promise.all([
    db().from("user_role").select("user_id, role:role_id(key, name), app_user:user_id(email, display_name)").eq("wedding_id", s.weddingId),
    db().from("wedding").select("name").eq("id", s.weddingId).single(),
    db().from("audit_log").select("id, action, target, actor, created_at").eq("wedding_id", s.weddingId).order("id", { ascending: false }).limit(100),
    db().auth.admin.listUsers({ perPage: 1000 }).then((r) => r.data?.users ?? []).catch(() => []),
  ]);
  const auth = new Map(authUsers.map((u) => [u.id, u]));
  const emailOf = new Map((urs ?? []).map((u) => [u.user_id, (u.app_user as unknown as { email: string } | null)?.email]));
  const modules = [...new Set(PERMISSIONS.map((p) => p.split(".")[0]!))];

  return (
    <main className="flex flex-col gap-8 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users and Roles</h1>
        <button className="btn-secondary" disabled title="Stage 2">
          Invite user (Stage 2)
        </button>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Users</h2>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm" data-testid="users-table">
            <thead className="bg-stone-50 text-left">
              <tr>
                {["Name", "Email", "Status", "Wedding", "Role", "Last active"].map((h) => (
                  <th key={h} className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(urs ?? []).map((u) => {
                const au = auth.get(u.user_id);
                const app = u.app_user as unknown as { email: string; display_name: string | null } | null;
                const role = u.role as unknown as { key: string; name: string };
                return (
                  <tr key={u.user_id + role.key} className="border-t">
                    <td className="p-2">{app?.display_name}</td>
                    <td className="p-2">{app?.email}</td>
                    <td className="p-2">{au ? ((au as { banned_until?: string }).banned_until ? "suspended" : au.email_confirmed_at ? "active" : "invited") : "unknown"}</td>
                    <td className="p-2">{wedding?.name}</td>
                    <td className="p-2">{role.name}</td>
                    <td className="p-2">{au?.last_sign_in_at ? new Date(au.last_sign_in_at).toLocaleString("en-IN") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Roles and permission catalogue</h2>
        <p className="mb-2 text-sm text-stone-600">Stage 1 uses a static role map; editing roles arrives with Postgres-backed permissions in Stage 2.</p>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm" data-testid="permission-matrix">
            <thead className="bg-stone-50 text-left">
              <tr>
                <th className="p-2">Module / permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="p-2 text-center">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.flatMap((m) => [
                <tr key={m} className="border-t bg-stone-50">
                  <td className="p-2 font-semibold" colSpan={ROLES.length + 1}>
                    {m}
                  </td>
                </tr>,
                ...PERMISSIONS.filter((p) => p.startsWith(m + ".")).map((p) => (
                  <tr key={p} className="border-t">
                    <td className="p-2 pl-6 font-mono text-xs">{p}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="p-2 text-center">
                        {(STATIC_ROLE_PERMISSIONS[r] as readonly string[]).includes(p) ? "●" : p === "queue.skip" && r === "stage" ? "flag" : ""}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <ComingSoon title="Edit roles and permissions" note="Stage 2: role_permission in Postgres." />
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Audit log</h2>
        <ul className="max-h-[32rem] divide-y overflow-auto rounded-lg border border-stone-200 bg-white text-sm" data-testid="audit-log">
          {(audit ?? []).length === 0 && <li className="p-3 text-stone-500">No entries.</li>}
          {(audit ?? []).map((a) => (
            <li key={a.id} className="grid grid-cols-[10rem_12rem_1fr_1fr] gap-2 p-2">
              <span className="text-stone-500">{new Date(a.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" })}</span>
              <span className="font-mono text-xs">{a.action}</span>
              <span className="truncate text-stone-600">{a.actor ? (emailOf.get(a.actor) ?? a.actor.slice(0, 8)) : "system"}</span>
              <span className="truncate font-mono text-xs text-stone-500">{a.target}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
