"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Tiny JSON form helper for simple staff forms. `render` gets the result of a successful post. */
export function PostForm({
  url,
  fields,
  submit,
  render,
  testid,
}: {
  url: string;
  fields: { name: string; label: string; type?: string; options?: { value: string; label: string }[]; required?: boolean }[];
  submit: string;
  render?: (result: Record<string, unknown>) => React.ReactNode;
  testid?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  return (
    <form
      data-testid={testid}
      className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const body: Record<string, unknown> = {};
        for (const f of fields) {
          const v = String(fd.get(f.name) ?? "").trim();
          if (!v) continue;
          body[f.name] = f.type === "datetime-local" ? new Date(v).toISOString() : v;
        }
        setBusy(true);
        setErr(null);
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setErr(j?.error?.issues?.[0]?.message ?? j?.error?.message ?? "Failed");
        setResult(j);
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }}
    >
      {fields.map((f) =>
        f.options ? (
          <select key={f.name} name={f.name} className="rounded border px-2 py-1" aria-label={f.label}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input key={f.name} name={f.name} type={f.type ?? "text"} placeholder={f.label} aria-label={f.label} required={f.required} className="rounded border px-2 py-1" />
        ),
      )}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : submit}
      </button>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {result && render?.(result)}
    </form>
  );
}
