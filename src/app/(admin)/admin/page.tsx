import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { auditPage, listRoles, listUsers } from "@/domain/admin/service";
import { AdminConsole } from "./AdminConsole";

export const dynamic = "force-dynamic";

/** Users and Roles (E3 T3) on E1's admin API. The server enforces every action again. */
export default async function AdminPage() {
  const s = await requirePage("users.manage", "/admin");
  const [canAudit, canRoles, canWeddings] = await Promise.all([hasPermission(s, "audit.read"), hasPermission(s, "roles.manage"), hasPermission(s, "weddings.manage")]);
  const [users, roles, audit] = await Promise.all([listUsers(s, "wedding"), listRoles(), canAudit ? auditPage(s, { limit: 50, scope: "wedding" }) : Promise.resolve(null)]);
  const wedding = s.weddings.find((w) => w.id === s.weddingId);
  return (
    <AdminConsole
      me={s.userId}
      wedding={{ id: s.weddingId, name: wedding?.name ?? "" }}
      can={{ audit: canAudit, roles: canRoles, weddings: canWeddings, superAdmin: s.isSuperAdmin }}
      initialUsers={users}
      initialRoles={roles}
      initialAudit={audit}
    />
  );
}
