"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApproveButton({ id, retry }: { id: string; retry: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        className="btn-primary"
        disabled={busy}
        data-testid="approve"
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const res = await fetch(`/api/ops/recommendations/${id}/approve`, { method: "POST" }).catch(() => null);
          setBusy(false);
          if (!res?.ok) setErr((await res?.json().catch(() => null))?.error?.message ?? "Request failed");
          router.refresh();
        }}
      >
        {busy ? "Applying…" : retry ? "Retry via Flagsmith" : "Approve"}
      </button>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </div>
  );
}
