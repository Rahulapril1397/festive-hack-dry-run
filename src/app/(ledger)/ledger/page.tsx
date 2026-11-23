import { redirect } from "next/navigation";
import { getSession } from "@/lib/authz";
import { listEvents } from "@/lib/db/service";
import { ledgerAccess } from "@/domain/ledger/service";
import { LedgerScreen } from "./LedgerScreen";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const s = await getSession();
  if (!s) redirect("/login?next=/ledger");
  const access = await ledgerAccess(s);
  if (!access.view) redirect("/denied?need=ledger.read");
  const events = await listEvents(s.weddingId);
  return <LedgerScreen access={access} events={events.map((e) => ({ id: e.id, name: e.name }))} />;
}
