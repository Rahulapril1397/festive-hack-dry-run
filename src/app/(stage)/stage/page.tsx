import Link from "next/link";
import { AutoRefresh } from "@/components/shell/AutoRefresh";
import { requirePage } from "@/components/shell/guard";
import { db } from "@/lib/db/service";

export const dynamic = "force-dynamic";

export default async function StageHome() {
  const s = await requirePage("queue.read", "/stage");
  const showTvLinks = s.permissions.has("queue.manage");
  const { data: events } = await db()
    .from("event")
    .select("id, name, starts_at, tv_key")
    .eq("wedding_id", s.weddingId)
    .order("starts_at", { ascending: true });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <AutoRefresh ms={5000} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events</h1>
        {s.permissions.has("queue.checkin") && (
          <Link className="btn-secondary" href="/stage/checkin">
            Check-in desk
          </Link>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {(events ?? []).map((e) => (
          <li key={e.id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{e.name}</p>
                {e.starts_at && <p className="text-sm text-stone-500">{new Date(e.starts_at).toLocaleString("en-IN")}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {s.permissions.has("queue.read") && (
                  <Link className="btn-primary" href={`/stage/${e.id}`} data-testid={`console-${e.name}`}>
                    Stage console
                  </Link>
                )}
                {showTvLinks && (
                  <Link className="btn-secondary" href={`/tv/${e.id}?key=${e.tv_key}`} target="_blank">
                    Open TV
                  </Link>
                )}
              </div>
            </div>
            {showTvLinks && (
              <p className="mt-2 break-all text-xs text-stone-500">
                Guest check-in link: <code>/checkin?event={e.id}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
