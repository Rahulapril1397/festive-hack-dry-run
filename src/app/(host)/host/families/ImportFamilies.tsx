"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportResult } from "@/contracts/admin";

/** Upload → E1's /api/admin/families/import → row errors + downloadable CSV of links and codes. */
export function ImportFamilies() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/admin/families/import", { method: "POST", body: fd }).catch(() => null);
    const j = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setErr(j?.error?.message ?? "Import failed");
    setResult(j as ImportResult);
    router.refresh();
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "family-links.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  const errors = result?.rows.filter((r) => r.status === "error") ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-white p-4 text-sm" data-testid="import-families">
      <p className="text-stone-600">Columns: <code>name, phone, language, headcount_max</code>. Bad rows are listed; the rest import.</p>
      <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} data-testid="import-file" />
      {busy && <p className="text-stone-500">Importing…</p>}
      {err && <p className="text-red-700">{err}</p>}
      {result && (
        <>
          <p data-testid="import-summary">
            {result.summary.created} imported, {result.summary.errors} with errors.
          </p>
          {errors.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded bg-red-50 p-2 text-red-900">
              {errors.map((r) => <li key={r.row}>Row {r.row} ({r.name || "no name"}): {r.error}</li>)}
            </ul>
          )}
          <button className="btn-primary" onClick={download} data-testid="download-result">
            Download links and codes (CSV)
          </button>
          <p className="text-xs text-stone-500">The CSV contains each family&apos;s private link and check-in code — share it only with the people sending invitations.</p>
        </>
      )}
    </div>
  );
}
