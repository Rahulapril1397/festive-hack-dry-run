import { eventForTvKey, getTvFeed } from "@/domain/queue/service";
import { TvBoard } from "./TvBoard";

export const dynamic = "force-dynamic";

/** /tv/:eventId?key=<event.tv_key>. Renders tokens and instructions only — never names, phones, amounts. */
export default async function TvPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ key?: string }> }) {
  const [{ eventId }, { key }] = await Promise.all([params, searchParams]);
  const ev = await eventForTvKey(eventId, key ?? null);
  if (!ev) {
    return <main className="grid min-h-dvh place-items-center bg-black text-2xl text-white">Invalid TV link</main>;
  }
  const initial = await getTvFeed(ev.id);
  return <TvBoard eventId={ev.id} tvKey={key!} eventName={ev.name} initial={initial} />;
}
