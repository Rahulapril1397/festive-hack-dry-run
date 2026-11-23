"use client";

import { useEffect, useState } from "react";
import type { QueueStatus } from "@/contracts/queue";

const REFRESH_MS = 5000;

export function PassView({ eventId, initial, labels }: { eventId: string; initial: QueueStatus; labels: Record<string, string> }) {
  const [s, setS] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setS(initial);
  }, [initial]);

  useEffect(() => {
    const id = setInterval(async () => {
      const res = await fetch(`/api/guest/status?eventId=${eventId}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) {
        setS(await res.json());
        setStale(false);
      } else setStale(true);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [eventId]);

  const L = (k: string) => labels[k] ?? k;
  const message =
    s.status === "called"
      ? L("pass.called")
      : s.status === "on_stage"
        ? L("pass.onStage")
        : s.status === "served"
          ? L("pass.served")
          : s.status === "no_show"
            ? L("pass.noShow")
            : s.paused
              ? L("pass.paused")
              : L("pass.help");

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 text-center" data-testid="pass-status">
      <p className={`text-sm font-semibold ${s.checkedIn ? "text-green-700" : "text-stone-500"}`}>
        {s.checkedIn ? `✓ ${L("pass.checkedIn")}` : L("pass.notCheckedIn")}
      </p>
      {s.token && (
        <>
          <p className="mt-4 text-sm uppercase tracking-widest text-stone-500">{L("pass.token")}</p>
          <p className="text-7xl font-black text-rose-800" data-testid="pass-token">
            {s.token}
          </p>
        </>
      )}
      {s.checkedIn && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-stone-100 p-3">
            <p className="text-xs text-stone-500">{L("pass.position")}</p>
            <p className="text-2xl font-bold" data-testid="pass-position">
              {s.position ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-stone-100 p-3">
            <p className="text-xs text-stone-500">{L("pass.nowServing")}</p>
            <p className="text-2xl font-bold">{s.nowServing ?? "—"}</p>
          </div>
        </div>
      )}
      {s.checkedIn && <p className="mt-4 font-medium text-stone-700">{message}</p>}
      {stale && <p className="mt-2 text-xs text-amber-700">{L("updating")}</p>}
    </section>
  );
}
