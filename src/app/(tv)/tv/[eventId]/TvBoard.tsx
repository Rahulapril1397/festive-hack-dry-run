"use client";

import { useEffect, useRef, useState } from "react";
import type { TvFeed } from "@/contracts/queue";
import { fetchAnnouncement } from "@/domain/queue/tvAudio";

const POLL_MS = 2000;
const SSE_RETRY_MS = 30_000;

const LABELS = {
  en: { now: "NOW CALLING", next: "Next", sound: "Tap anywhere to enable sound" },
  hi: { now: "अभी बुलाया जा रहा है", next: "अगला", sound: "आवाज़ चालू करने के लिए स्क्रीन छुएँ" },
} as const;

export function TvBoard({ eventId, tvKey, eventName, initial }: { eventId: string; tvKey: string; eventName: string; initial: TvFeed | null }) {
  const [feed, setFeed] = useState<TvFeed | null>(initial);
  const [soundOn, setSoundOn] = useState(false);
  const [live, setLive] = useState<"sse" | "poll">("sse");
  const lastAnnouncement = useRef<string | null>(initial?.announcementId ?? null); // don't replay on load
  const playing = useRef<Promise<void>>(Promise.resolve());
  const chime = useRef<HTMLAudioElement | null>(null);
  const soundRef = useRef(false);
  soundRef.current = soundOn;

  // ── transport: SSE first, 2-second polling fallback ────────────────────────────────────
  useEffect(() => {
    const qs = `eventId=${encodeURIComponent(eventId)}&key=${encodeURIComponent(tvKey)}`;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const startPolling = () => {
      if (poll) return;
      setLive("poll");
      const tick = async () => {
        const res = await fetch(`/api/tv/feed?${qs}`, { cache: "no-store" }).catch(() => null);
        if (res?.ok) setFeed((await res.json()).feed);
      };
      void tick();
      poll = setInterval(tick, POLL_MS);
    };
    const stopPolling = () => {
      clearInterval(poll);
      poll = undefined;
    };
    const openSse = () => {
      if (stopped || typeof EventSource === "undefined") return startPolling();
      es = new EventSource(`/api/tv/stream?${qs}`);
      es.addEventListener("feed", (ev) => setFeed(JSON.parse((ev as MessageEvent).data)));
      es.onopen = () => {
        stopPolling();
        setLive("sse");
      };
      es.onerror = () => {
        es?.close();
        startPolling();
        retry = setTimeout(openSse, SSE_RETRY_MS);
      };
    };
    openSse();
    return () => {
      stopped = true;
      es?.close();
      stopPolling();
      clearTimeout(retry);
    };
  }, [eventId, tvKey]);

  // ── announcements: audio from E2 (C3) within 3.5 s, else the local chime ───────────────
  useEffect(() => {
    const id = feed?.announcementId;
    if (!id || id === lastAnnouncement.current) return;
    lastAnnouncement.current = id;
    playing.current = playing.current.then(() => announce(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.announcementId]);

  async function announce(id: string) {
    const outcome = await fetchAnnouncement(id);
    if (!soundRef.current) return;
    if (outcome.kind === "audio") {
      const url = URL.createObjectURL(outcome.blob);
      try {
        await playAndWait(new Audio(url));
        return;
      } catch {
        // fall through to chime
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    void fetch("/api/tv/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "chime", eventId, announcementId: id, reason: outcome.kind === "chime" ? outcome.reason : "play_failed" }),
      keepalive: true,
    }).catch(() => {});
    await playAndWait(chime.current).catch(() => {});
  }

  const lang = feed?.language ?? "en";
  const L = LABELS[lang];

  return (
    <main
      className="relative flex min-h-dvh cursor-none select-none flex-col bg-black text-white"
      onClick={() => {
        if (!soundOn) {
          setSoundOn(true);
          chime.current?.load();
        }
      }}
      data-testid="tv"
    >
      <audio ref={chime} src="/chime.mp3" preload="auto" />
      <header className="flex items-center justify-between px-10 py-6 text-3xl text-stone-400">
        <span>{eventName}</span>
        <span className={`h-4 w-4 rounded-full ${live === "sse" ? "bg-green-500" : "bg-amber-500"}`} title={live} />
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <p className="text-5xl font-bold tracking-widest text-amber-300">{L.now}</p>
        <p className="font-black leading-none text-white" style={{ fontSize: "min(40vh, 40vw)" }} data-testid="tv-token">
          {feed?.token ?? "—"}
        </p>
        <p className="max-w-[80vw] text-5xl font-semibold" data-testid="tv-instruction">
          {feed?.instruction ?? ""}
        </p>
      </section>

      <footer className="flex justify-center pb-10 text-5xl text-stone-300">
        {L.next}: <span className="ml-4 font-bold text-white" data-testid="tv-next">{feed?.nextToken ?? "—"}</span>
      </footer>

      {!soundOn && (
        <div className="absolute inset-x-0 bottom-0 bg-amber-500 py-3 text-center text-2xl font-semibold text-black" data-testid="tv-enable-sound">
          {L.sound}
        </div>
      )}
    </main>
  );
}

function playAndWait(el: HTMLAudioElement | null): Promise<void> {
  if (!el) return Promise.reject(new Error("no audio element"));
  el.currentTime = 0;
  return new Promise((resolve, reject) => {
    el.onended = () => resolve();
    el.onerror = () => reject(new Error("audio error"));
    el.play().catch(reject);
  });
}
