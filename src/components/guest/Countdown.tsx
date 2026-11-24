"use client";

import { useEffect, useState } from "react";

/** Days / hours / mins / secs until the wedding date (local midnight). Renders blanks until mounted so server and browser agree. */
export function Countdown({ date, labels }: { date: string; labels: { days: string; hours: string; mins: string; secs: string } }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = now === null ? null : Math.max(0, new Date(date).getTime() - now);
  const parts = left === null ? ["--", "--", "--", "--"] : [Math.floor(left / 86400000), Math.floor(left / 3600000) % 24, Math.floor(left / 60000) % 60, Math.floor(left / 1000) % 60].map((n) => String(n).padStart(2, "0"));
  const names = [labels.days, labels.hours, labels.mins, labels.secs];
  return (
    <div className="mt-4 flex items-start justify-center divide-x divide-amber-300/70" data-testid="countdown">
      {parts.map((p, i) => (
        <div key={i} className="px-3 text-center">
          <p className="font-display text-3xl font-bold leading-none text-rose-900">{p}</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-amber-700">{names[i]}</p>
        </div>
      ))}
    </div>
  );
}
