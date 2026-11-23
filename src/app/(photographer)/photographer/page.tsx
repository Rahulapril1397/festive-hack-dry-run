import { requirePage } from "@/components/shell/guard";
import { listEvents } from "@/lib/db/service";
import { Uploader } from "./Uploader";

export const dynamic = "force-dynamic";

export default async function PhotographerPage() {
  const s = await requirePage("photos.upload", "/photographer");
  const events = await listEvents(s.weddingId);
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Photographer</h1>
      <p className="text-sm text-stone-600">
        Photos are matched to stage calls by time only (no face recognition), and every match is confirmed by a person.
      </p>
      <Uploader events={events.map((e) => ({ id: e.id, name: e.name }))} />
    </main>
  );
}
