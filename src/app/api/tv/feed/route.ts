import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { eventForTvKey, getTvFeed } from "@/domain/queue/service";

export const dynamic = "force-dynamic";

/** Polling fallback for the TV. GET ?eventId&key → TvFeed | null. Tokens only, no PII. */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId") ?? "";
  const ev = await eventForTvKey(eventId, url.searchParams.get("key"));
  if (!ev) throw new AppError("FORBIDDEN");
  return json({ feed: await getTvFeed(ev.id) }, { headers: { "cache-control": "no-store" } });
});
