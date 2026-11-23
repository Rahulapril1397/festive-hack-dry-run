"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewItem } from "@/domain/photos/service";

const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + "." + String(new Date(iso).getMilliseconds()).padStart(3, "0") : "—");

export function ReviewCard({ item }: { item: ReviewItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (candidateId: string, decision: "confirmed" | "rejected") => {
    setBusy(true);
    await fetch(`/api/photos/candidates/${candidateId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white" data-testid="review-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.thumbUrl ? <img src={item.thumbUrl} alt="" className="aspect-[4/3] w-full bg-stone-100 object-cover" loading="lazy" /> : <div className="aspect-[4/3] bg-stone-100" />}
      <div className="flex flex-col gap-2 p-3 text-sm">
        <p className="text-stone-600">
          {item.camera} · corrected <span className="font-mono">{ist(item.correctedAt)}</span>
        </p>
        {item.status === "matched" && <p className="font-semibold text-green-700">Matched to token {item.matchedToken}</p>}
        {item.candidates.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded bg-stone-50 p-2">
            <span>
              Token <b className="text-lg">{c.token}</b> · {c.action === "on_stage" ? "on stage" : "called"} · {(c.deltaMs / 1000).toFixed(1)} s
            </span>
            <span className="flex gap-1">
              <button className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => decide(c.id, "confirmed")} data-testid="confirm">
                Confirm
              </button>
              <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => decide(c.id, "rejected")}>
                Reject
              </button>
            </span>
          </div>
        ))}
        {item.status === "unmatched" && <p className="text-stone-500">No stage call within the window.</p>}
      </div>
    </div>
  );
}
