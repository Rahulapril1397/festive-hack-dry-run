import { eventForTvKey, getTvFeed } from "@/domain/queue/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const MAX_LIFETIME_MS = 30 * 60_000; // client reconnects; keeps Cloud Run requests bounded

/**
 * SSE: GET /api/tv/stream?eventId&key. Emits `event: feed` with the TvFeed JSON whenever
 * tv_feed.updated_at changes. Server-side polling of one row per TV keeps this independent of
 * Realtime; a handful of TVs per wedding makes the cost negligible.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ev = await eventForTvKey(url.searchParams.get("eventId") ?? "", url.searchParams.get("key"));
  if (!ev) return new Response("forbidden", { status: 403 });

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = "";
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearInterval(beat);
        try {
          controller.close();
        } catch {}
      };
      const push = async () => {
        try {
          const feed = await getTvFeed(ev.id);
          const stamp = feed?.updatedAt ?? "none";
          if (stamp !== last) {
            last = stamp;
            controller.enqueue(enc.encode(`event: feed\ndata: ${JSON.stringify(feed)}\n\n`));
          }
        } catch {
          // transient DB error: keep the stream; next tick retries
        }
      };
      controller.enqueue(enc.encode(`retry: 2000\n\n`));
      await push();
      timer = setInterval(push, POLL_MS);
      beat = setInterval(() => !closed && controller.enqueue(enc.encode(`: ping\n\n`)), HEARTBEAT_MS);
      setTimeout(close, MAX_LIFETIME_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(timer);
      clearInterval(beat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
