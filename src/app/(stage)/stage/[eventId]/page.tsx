import { notFound, redirect } from "next/navigation";
import { getSession, hasPermission, requirePermission } from "@/lib/authz";
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
        call: await hasPermission(s, "queue.call_next", event.wedding_id),
        manage: await hasPermission(s, "queue.manage", event.wedding_id),
        skip: await hasPermission(s, "queue.skip", event.wedding_id),
        clock: await hasPermission(s, "clock.read", event.wedding_id),
      }}
    />
  );
}
