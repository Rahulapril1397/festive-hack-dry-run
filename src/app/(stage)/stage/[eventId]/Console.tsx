"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotentAction, type IdempotentAction } from "@/domain/queue/idempotency";
import { canApply, type EntryAction } from "@/domain/queue/stateMachine";
import type { QueueEntryStatus } from "@/contracts/queue";
import { ClockPanel } from "./ClockPanel";

type Entry = {
  entryId: string;
  token: number;
  familyName: string;
  isWalkIn: boolean;
  status: QueueEntryStatus;
  skipCount: number;
  calledAt: string | null;
};
type Snapshot = {
  paused: boolean;
  currentEntryId: string | null;
  entries: Entry[];
  counts: Record<string, number> | null;
  recent: { id: string; action: string; token: number | null; at: string }[];
};
type ApiRes = { status: number; body: { error?: { code: string; message: string } } & Record<string, unknown> };

const MESSAGES: Record<string, string> = {
  QUEUE_PAUSED: "Queue is paused — press RESUME first.",
  QUEUE_EMPTY: "No one is waiting.",
  INVALID_TRANSITION: "That action no longer applies — the list has been refreshed.",
  FORBIDDEN: "You don't have permission for that.",
  UNAUTHENTICATED: "Session expired — please sign in again.",
};

async function post(url: string, key: string, body?: unknown): Promise<ApiRes> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export function Console({ eventId, eventName, can }: { eventId: string; eventName: string; can: { call: boolean; manage: boolean; clock: boolean } }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showClock, setShowClock] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/queue/${eventId}`, { cache: "no-store" });
    if (res.ok) setSnap(await res.json());
    else if (res.status === 401) window.location.href = `/login?next=/stage/${eventId}`;
  }, [eventId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // One persistent action: a double-tap returns the in-flight request; an inconclusive failure
  // keeps its key so the next press retries the same call instead of calling a second family.
  const callNextRef = useRef<IdempotentAction<ApiRes["body"]> | null>(null);
  callNextRef.current ??= createIdempotentAction((key) => post(`/api/queue/${eventId}/call-next`, key));

  function report(res: ApiRes, okText: string) {
    if (res.status < 300) setFlash({ kind: "ok", text: okText });
    else setFlash({ kind: "err", text: MESSAGES[res.body.error?.code ?? ""] ?? res.body.error?.message ?? "Failed" });
  }

  async function run(fn: () => Promise<ApiRes>, okText: (r: ApiRes) => string) {
    setBusy(true);
    try {
      const r = await fn();
      report(r, okText(r));
    } catch {
      setFlash({ kind: "err", text: "Network problem — press again to retry the same action." });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const callNext = () => run(() => callNextRef.current!.press(), (r) => `Called token ${String(r.body.token)}`);

  const act = (slug: string, entryId?: string) => {
    const action = createIdempotentAction((key) => post(`/api/queue/${eventId}/${slug}`, key, entryId ? { entryId } : {}));
    return run(() => action.press(), () => `Done: ${slug}`);
  };

  const waiting = snap?.entries.filter((e) => e.status === "waiting") ?? [];
  const active = snap?.entries.filter((e) => e.status !== "waiting") ?? [];
  const allow = (e: Entry, a: EntryAction) => can.manage && canApply({ status: e.status, skipCount: e.skipCount }, a);

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[1fr_22rem]">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{eventName} · Stage</h1>
          <div className="flex gap-2">
            {can.manage &&
              (snap?.paused ? (
                <button className="btn bg-green-700 text-white" disabled={busy} onClick={() => act("resume")} data-testid="resume">
                  RESUME
                </button>
              ) : (
                <button className="btn bg-amber-500 text-amber-950" disabled={busy || !snap} onClick={() => act("pause")} data-testid="pause">
                  PAUSE
                </button>
              ))}
            {can.clock && (
              <button className="btn-secondary" onClick={() => setShowClock((v) => !v)}>
                Clock calibration
              </button>
            )}
          </div>
        </div>

        {snap?.paused && <div className="rounded-lg bg-amber-100 p-3 font-semibold text-amber-900">Queue paused</div>}

        {can.call && (
          <button
            className="btn-primary h-28 text-4xl tracking-wide shadow-lg"
            disabled={busy || !snap || snap.paused}
            onClick={callNext}
            data-testid="call-next"
          >
            CALL NEXT
          </button>
        )}

        {flash && (
          <p role="status" className={`rounded-lg p-3 ${flash.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`} data-testid="flash">
            {flash.text}
          </p>
        )}

        {active.length > 0 && (
          <div>
            <h2 className="mb-2 font-semibold">Called / on stage</h2>
            <ul className="flex flex-col gap-2">
              {active.map((e) => (
                <li key={e.entryId} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${e.entryId === snap?.currentEntryId ? "border-rose-500 bg-rose-50" : "border-stone-200 bg-white"}`}>
                  <span className="w-16 text-3xl font-black">{e.token}</span>
                  <span className="flex-1">
                    {e.familyName} <span className="text-xs uppercase text-stone-500">{e.status.replace("_", " ")}</span>
                  </span>
                  <button className="btn-secondary" disabled={busy || !allow(e, "on_stage")} onClick={() => act("on-stage", e.entryId)}>
                    On stage
                  </button>
                  <button className="btn-secondary" disabled={busy || !allow(e, "served")} onClick={() => act("served", e.entryId)}>
                    Served
                  </button>
                  <button className="btn-secondary" disabled={busy || !allow(e, "skip")} onClick={() => act("skip", e.entryId)} data-testid={`skip-${e.token}`}>
                    Skip
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h2 className="mb-2 font-semibold">Waiting ({waiting.length})</h2>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white" data-testid="waiting-list">
            {waiting.length === 0 && <li className="p-3 text-stone-500">No one waiting.</li>}
            {waiting.map((e, i) => (
              <li key={e.entryId} className="flex items-center gap-3 p-3">
                <span className="w-8 text-stone-400">{i + 1}</span>
                <span className="w-16 text-2xl font-bold">{e.token}</span>
                <span className="flex-1">
                  {e.familyName}
                  {e.isWalkIn && <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-800">walk-in</span>}
                  {e.skipCount > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">skipped {e.skipCount}×</span>}
                </span>
                {can.manage && (
                  <button className="btn-secondary text-sm" disabled={busy} onClick={() => act("skip", e.entryId)}>
                    Skip
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        {showClock && <ClockPanel />}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <h2 className="mb-2 font-semibold">Recent</h2>
          <ul className="flex flex-col gap-1 text-sm" data-testid="recent">
            {snap?.recent.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>
                  {r.action.replace("_", " ")} {r.token != null && <b>#{r.token}</b>}
                </span>
                <span className="text-stone-500">{new Date(r.at).toLocaleTimeString("en-IN")}</span>
              </li>
            ))}
          </ul>
        </div>
        {snap?.counts && (
          <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
            {Object.entries(snap.counts).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k.replace("_", " ")}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        )}
      </aside>
    </main>
  );
}
