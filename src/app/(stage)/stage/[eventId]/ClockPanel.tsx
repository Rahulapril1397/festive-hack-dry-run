"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Contract C4: QR of `PA|<t_ms>|<sig>`, refreshed every second, for photographers' cameras. */
export function ClockPanel() {
  const [img, setImg] = useState<string | null>(null);
  const [t, setT] = useState<number | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/clock/now", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { t_ms: number; qr: string };
        const url = await QRCode.toDataURL(body.qr, { margin: 1, width: 320, errorCorrectionLevel: "M" });
        if (alive) {
          setImg(url);
          setT(body.t_ms);
          setErr(false);
        }
      } catch {
        if (alive) setErr(true);
      }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 text-center">
      <h2 className="mb-2 font-semibold">Clock calibration</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img ? <img src={img} alt="Clock QR" className="mx-auto w-64" data-testid="clock-qr" /> : <div className="h-64" />}
      <p className="mt-2 font-mono text-sm">{t ? new Date(t).toISOString().slice(11, 23) : "…"} UTC</p>
      {err && <p className="text-sm text-red-700">Clock unavailable</p>}
      <p className="mt-1 text-xs text-stone-500">Photographers: take a photo of this code with each camera.</p>
    </div>
  );
}
