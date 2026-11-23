import { notFound, redirect } from "next/navigation";
import { getSession, requirePermission } from "@/lib/authz";
import { roleHas } from "@/lib/authz/staticMap";
import { getEvent } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { Console } from "./Console";

export const dynamic = "force-dynamic";

export default async function StageConsolePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const s = await getSession();
  if (!s) redirect(`/login?next=/stage/${eventId}`);
  let event;
  try {
    event = await getEvent(eventId);
    await requirePermission(s, "queue.read", event.wedding_id);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") redirect("/stage");
    notFound();
  }
  return (
    <Console
      eventId={event.id}
      eventName={event.name}
      can={{
        call: roleHas(s.role, "queue.call_next"),
        manage: roleHas(s.role, "queue.manage"),
        clock: roleHas(s.role, "clock.read"),
      }}
    />
  );
}
