import { requirePage } from "@/components/shell/guard";
import { listPeople, listWeddingRoles } from "@/domain/people/service";
import { PeopleConsole } from "./PeopleConsole";

export const dynamic = "force-dynamic";

/** People (Stage 3 E1 T3): participants, invites, dated assignments, custom roles, deny overrides. */
export default async function PeoplePage() {
  const s = await requirePage("users.manage", "/people");
  const [people, roles] = await Promise.all([listPeople(s.weddingId), listWeddingRoles(s.weddingId)]);
  return <PeopleConsole me={s.userId} myPermissions={[...s.permissions]} superAdmin={s.isSuperAdmin} initialPeople={people} initialRoles={roles} />;
}
