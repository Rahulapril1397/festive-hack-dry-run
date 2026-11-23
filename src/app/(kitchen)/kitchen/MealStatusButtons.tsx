"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATES = [
  ["not_started", "Not started"],
  ["serving", "Serving"],
  ["closed", "Closed"],
] as const;

export function MealStatusButtons({ eventId, current }: { eventId: string; current: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 flex gap-2">
      {STATES.map(([v, label]) => (
        <button
          key={v}
          disabled={busy || v === current}
          className={v === current ? "btn-primary px-2 py-1 text-xs" : "btn-secondary px-2 py-1 text-xs"}
          onClick={async () => {
            setBusy(true);
            await fetch("/api/kitchen/meal-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, status: v }) });
            setBusy(false);
            router.refresh();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
