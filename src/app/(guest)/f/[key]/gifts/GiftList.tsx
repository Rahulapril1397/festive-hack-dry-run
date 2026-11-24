"use client";

import { useState } from "react";
import type { GuestGift } from "@/domain/gifts/service";

type L = Record<"claim" | "release" | "yours" | "received" | "taken" | "left" | "unavailable" | "empty" | "view" | "error", string>;

export function GiftList({ initial, labels, priceLabels }: { initial: GuestGift[]; labels: L; priceLabels: Record<string, string> }) {
  const [gifts, setGifts] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const reload = async () => {
    const r = await fetch("/api/guest/gifts", { cache: "no-store" });
    if (r.ok) setGifts((await r.json()).gifts);
  };
  const act = async (id: string, url: string, body?: unknown) => {
    setBusy(id);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setMsg(j?.error?.code === "GIFT_UNAVAILABLE" ? labels.unavailable : labels.error);
      }
      await reload();
    } finally {
      setBusy(null);
    }
  };

  if (!gifts.length) return <p className="rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-500">{labels.empty}</p>;
  return (
    <>
      {msg && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="gift-msg">
          {msg}
        </p>
      )}
      <ul className="flex flex-col gap-3" data-testid="gift-list">
        {gifts.map((g) => {
          const mine = g.myClaim;
          const taken = !mine && g.remaining === 0;
          return (
            <li key={g.id} className={`overflow-hidden rounded-2xl border bg-white ${mine ? "border-rose-300 ring-2 ring-rose-100" : "border-stone-200"} ${taken ? "opacity-60" : ""}`} data-testid="gift">
              {g.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket
                <img src={g.imageUrl} alt="" className="h-40 w-full object-cover" />
              )}
              <div className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-semibold">{g.title}</p>
                  {g.priceBand && <span className="whitespace-nowrap rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{priceLabels[g.priceBand]}</span>}
                </div>
                {g.description && <p className="text-sm text-stone-600">{g.description}</p>}
                {g.link && (
                  <a href={g.link} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-rose-700 underline">
                    {labels.view}
                  </a>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-stone-500">{mine ? (mine.status === "fulfilled" ? labels.received : labels.yours) : taken ? labels.taken : g.quantity > 1 ? `${g.remaining} ${labels.left}` : ""}</span>
                  {mine ? (
                    mine.status === "claimed" && (
                      <button className="btn-secondary !py-1.5 text-sm" disabled={busy === g.id} onClick={() => act(g.id, `/api/guest/gifts/claims/${mine.id}/release`)} data-testid="gift-release">
                        {labels.release}
                      </button>
                    )
                  ) : (
                    !taken && (
                      <button className="btn-primary !py-1.5 text-sm" disabled={busy === g.id} onClick={() => act(g.id, `/api/guest/gifts/${g.id}/claim`, { quantity: 1 })} data-testid="gift-claim">
                        {labels.claim}
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
