import { z } from "zod";
import { db } from "@/lib/db/service";
import { DemoBanner } from "@/components/DemoBanner";
import { CheckinForm } from "./CheckinForm";

export const dynamic = "force-dynamic";

/** Public guest check-in. The venue QR links to /checkin?event=<eventId>. */
export default async function CheckinPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event } = await searchParams;
  const ok = z.string().uuid().safeParse(event).success;
  const { data } = ok
    ? await db().from("event").select("id, name, wedding:wedding_id(name, is_demo)").eq("id", event!).maybeSingle()
    : { data: null };

  if (!data) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-2xl font-bold">Check-in</h1>
        <p className="mt-4 text-stone-600">Please scan the check-in QR code at the venue.</p>
      </main>
    );
  }
  const wedding = (Array.isArray(data.wedding) ? data.wedding[0] : data.wedding) as { name: string; is_demo: boolean } | null;

  return (
    <>
      <DemoBanner show={!!wedding?.is_demo} />
      <main className="mx-auto max-w-md p-6">
        <p className="text-sm uppercase tracking-wide text-rose-700">{wedding?.name}</p>
        <h1 className="mb-6 text-3xl font-bold">{data.name} · Check-in</h1>
        <CheckinForm eventId={data.id} />
      </main>
    </>
  );
}
