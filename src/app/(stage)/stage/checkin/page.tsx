import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { roleHas } from "@/lib/authz/staticMap";
import { listEvents } from "@/lib/db/service";
import { DeskForm } from "./DeskForm";

export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const s = await getSession();
  if (!s) redirect("/login?next=/stage/checkin");
  if (!roleHas(s.role, "queue.checkin")) redirect("/stage");
  const events = await listEvents(s.weddingId);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Check-in desk</h1>
      <DeskForm events={events.map((e) => ({ id: e.id, name: e.name }))} />
    </main>
  );
}
