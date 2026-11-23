import Link from "next/link";
import { requirePage } from "@/components/shell/guard";
import { listEvents } from "@/lib/db/service";
import { reviewList } from "@/domain/photos/service";
import { BUCKET_LABEL, countBuckets } from "@/domain/photos/match";
import { ReviewCard } from "./ReviewCard";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ event?: string; bucket?: string }> }) {
  const s = await requirePage("photos.review", "/photographer/review");
  const sp = await searchParams;
  const events = await listEvents(s.weddingId);
  const eventId = events.find((e) => e.id === sp.event)?.id ?? events.at(-1)?.id;
  const items = eventId ? await reviewList(s, eventId) : [];
  const counts = countBuckets(items.map((i) => i.status));
  const bucket = (["matched", "check", "unmatched"] as const).find((b) => b === sp.bucket) ?? "check";
  const shown = items.filter((i) => i.status === bucket);

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Photo review</h1>
      <nav className="flex flex-wrap gap-2">
        {events.map((e) => (
          <Link key={e.id} href={`?event=${e.id}&bucket=${bucket}`} className={`rounded-full px-3 py-1 text-sm ${e.id === eventId ? "bg-rose-700 text-white" : "border bg-white"}`}>
            {e.name}
          </Link>
        ))}
      </nav>
      <div className="grid grid-cols-3 gap-3" data-testid="match-counters">
        {(["matched", "check", "unmatched"] as const).map((b) => (
          <Link key={b} href={`?event=${eventId}&bucket=${b}`} className={`rounded-xl border p-3 ${b === bucket ? "border-rose-600 bg-rose-50" : "bg-white"}`} data-testid={`count-${b}`}>
            <p className="text-xs text-stone-500">{BUCKET_LABEL[b]}</p>
            <p className="text-2xl font-bold">{counts[b]}</p>
          </Link>
        ))}
      </div>
      {shown.length === 0 && <p className="text-stone-500">Nothing in “{BUCKET_LABEL[bucket]}”.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((i) => (
          <ReviewCard key={i.id} item={i} />
        ))}
      </div>
    </main>
  );
}
