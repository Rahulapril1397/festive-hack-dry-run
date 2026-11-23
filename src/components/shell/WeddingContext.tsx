"use client";

import { createContext, useCallback, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type WeddingOption = { id: string; name: string; isDemo: boolean; roles: string[] };
type Ctx = { weddingId: string; weddings: WeddingOption[]; switching: boolean; setWedding: (id: string) => Promise<void> };

const WeddingCtx = createContext<Ctx | null>(null);

/** useWedding(): the selected wedding for every screen. Switching re-renders all server data. */
export function useWedding(): Ctx {
  const c = useContext(WeddingCtx);
  if (!c) throw new Error("useWedding() must be used inside <WeddingProvider>");
  return c;
}

export function WeddingProvider({ weddingId, weddings, children }: { weddingId: string; weddings: WeddingOption[]; children: React.ReactNode }) {
  const router = useRouter();
  const [current, setCurrent] = useState(weddingId);
  const [switching, start] = useTransition();
  const setWedding = useCallback(
    async (id: string) => {
      const res = await fetch("/api/session/wedding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weddingId: id }) });
      if (!res.ok) return;
      setCurrent(id);
      start(() => router.refresh());
    },
    [router],
  );
  return <WeddingCtx.Provider value={{ weddingId: current, weddings, switching, setWedding }}>{children}</WeddingCtx.Provider>;
}

export function WeddingSelect() {
  const { weddingId, weddings, switching, setWedding } = useWedding();
  if (weddings.length === 0) return null;
  return (
    <select
      className="max-w-[14rem] rounded border border-stone-300 bg-white px-2 py-0.5 text-sm"
      aria-label="Wedding"
      value={weddingId}
      disabled={switching || weddings.length < 2}
      onChange={(e) => void setWedding(e.target.value)}
      data-testid="wedding-select"
    >
      {weddings.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
