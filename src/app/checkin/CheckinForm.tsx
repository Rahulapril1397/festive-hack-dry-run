"use client";

import { useState } from "react";
import type { CheckinResult } from "@/contracts/queue";

export function CheckinForm({ eventId }: { eventId: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code, eventId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body?.error?.code === "CHECKIN_LOCKED"
            ? "Too many attempts. Please ask the check-in desk."
            : "We couldn't match that phone number and code. Please check and try again.",
        );
      } else setResult(body as CheckinResult);
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow" data-testid="checkin-success">
        <p className="text-stone-600">Your token</p>
        <p className="my-2 text-7xl font-black text-rose-800" data-testid="token">
          {result.token}
        </p>
        {result.position && <p className="text-lg">You are number {result.position} in the queue.</p>}
        {result.status === "called" && <p className="text-lg font-semibold">You have been called — please go to the stage.</p>}
        <p className="mt-4 text-sm text-stone-600">Watch the screen near the stage for your token.</p>
        <a className="btn-primary mt-6 w-full" href={result.familyLink}>
          Open your family pass
        </a>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Phone number</span>
        <input className="input" inputMode="tel" autoComplete="tel" placeholder="98765 00001" value={phone} onChange={(e) => setPhone(e.target.value)} required data-testid="phone" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">4-digit code (from your invitation)</span>
        <input className="input tracking-[0.5em]" inputMode="numeric" pattern="\d{4}" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required data-testid="code" />
      </label>
      {error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      <button className="btn-primary py-3 text-lg" disabled={busy} data-testid="checkin-submit">
        {busy ? "Checking in…" : "Check in"}
      </button>
    </form>
  );
}
