"use client";

import { useMemo, useState } from "react";
import type { HostNote, VariantResult } from "@/domain/thanks/service";
import { api } from "@/components/shell/api";

type Data = { templates: Record<"A" | "B", string>; notes: HostNote[]; results: VariantResult[] };
const TABS = ["Notes", "Templates", "Results"] as const;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export function ThanksConsole({ initial }: { initial: Data }) {
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]>(initial.notes.length ? "Notes" : "Templates");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const reload = async () => setD(await api<Data>("/api/host/thanks"));
  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    setBusy(true);
    try {
      const ok = await fn();
      await reload();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const drafts = useMemo(() => d.notes.filter((n) => n.status === "draft"), [d.notes]);

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Thank-you notes</h1>
      <nav className="flex gap-2 border-b" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-rose-700 font-semibold" : "border-transparent text-stone-600"}`}>
            {t}
          </button>
        ))}
      </nav>
      {msg && <p className={`rounded p-2 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`} data-testid="thanks-msg">{msg.text}</p>}

      {tab === "Templates" && (
        <section className="grid gap-4 md:grid-cols-2">
          <p className="text-sm text-stone-600 md:col-span-2">
            Two versions are tested: each family gets A or B (fixed per family). Use <code>{"{family}"}</code>, <code>{"{gift}"}</code> and <code>{"{couple}"}</code> — names are filled in after translation and are never sent to the translation service.
          </p>
          {(["A", "B"] as const).map((v) => (
            <form
              key={v}
              className="flex flex-col gap-2 rounded-xl border bg-white p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const body = String(new FormData(e.currentTarget).get("body") ?? "");
                void run(async () => (await api("/api/host/thanks/templates", { method: "PUT", body: { variant: v, body } }), `Version ${v} saved`));
              }}
            >
              <h2 className="font-semibold">Version {v}</h2>
              <textarea name="body" defaultValue={d.templates[v]} rows={6} minLength={10} maxLength={1500} className="input !text-base" data-testid={`template-${v}`} />
              <button className="btn-secondary self-start !py-1.5" disabled={busy}>
                Save version {v}
              </button>
            </form>
          ))}
        </section>
      )}

      {tab === "Notes" && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} data-testid="generate-drafts" onClick={() => run(async () => {
              const r = await api<{ created: number; untranslated: number; skippedSent: number }>("/api/host/thanks/generate", { method: "POST", body: {} });
              return `${r.created} drafts ready for attending families${r.untranslated ? ` · ${r.untranslated} kept in English (translation unavailable)` : ""}${r.skippedSent ? ` · ${r.skippedSent} already sent` : ""}`;
            })}>
              {busy ? "Working…" : "Prepare drafts"}
            </button>
            <button className="btn-secondary" disabled={busy || selected.size === 0} data-testid="send-selected" onClick={() => run(async () => {
              const r = await api<{ sent: number }>("/api/host/thanks/send", { method: "POST", body: { ids: [...selected] } });
              setSelected(new Set());
              return `${r.sent} notes sent — families see them on their pass`;
            })}>
              Send selected ({selected.size})
            </button>
            {drafts.length > 0 && (
              <button className="text-sm underline" onClick={() => setSelected(selected.size === drafts.length ? new Set() : new Set(drafts.map((n) => n.id)))}>
                {selected.size === drafts.length ? "Clear selection" : `Select all ${drafts.length} drafts`}
              </button>
            )}
          </div>
          {d.notes.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-stone-500">No notes yet. “Prepare drafts” writes one per attending family from your templates.</p>}
          <ul className="flex flex-col gap-2" data-testid="notes-list">
            {d.notes.map((n) => (
              <li key={n.id} className="rounded-xl border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {n.status === "draft" && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${n.familyName}`}
                      checked={selected.has(n.id)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(n.id);
                        else s.delete(n.id);
                        setSelected(s);
                      }}
                    />
                  )}
                  <b>{n.familyName}</b>
                  <span className="rounded bg-stone-100 px-1.5 text-xs">v{n.variant}</span>
                  <span className="rounded bg-stone-100 px-1.5 text-xs">{n.language}</span>
                  {n.language !== "en" && !n.translated && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">not translated</span>}
                  {n.giftTitle && <span className="text-xs text-stone-500">🎁 {n.giftTitle}</span>}
                  {n.hasPhoto && <span className="text-xs text-stone-500">📷 photo</span>}
                  <span className="flex-1" />
                  <span className={`text-xs ${n.status === "sent" ? (n.opened_at ? "text-green-800" : "text-stone-600") : "text-stone-500"}`}>
                    {n.status === "draft" ? "draft" : n.opened_at ? `opened ${new Date(n.opened_at).toLocaleDateString("en-IN")}` : "sent, not opened yet"}
                  </span>
                  {n.status === "draft" && editing !== n.id && (
                    <button className="text-xs underline" onClick={() => setEditing(n.id)}>
                      Edit
                    </button>
                  )}
                </div>
                {editing === n.id ? (
                  <form
                    className="mt-2 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const body = String(new FormData(e.currentTarget).get("body") ?? "");
                      void run(async () => (await api(`/api/host/thanks/notes/${n.id}`, { method: "PATCH", body: { body } }), setEditing(null), "Draft saved"));
                    }}
                  >
                    <textarea name="body" defaultValue={n.body} rows={4} className="input !text-base" />
                    <div className="flex gap-2">
                      <button className="btn-primary !py-1">Save</button>
                      <button type="button" className="btn-secondary !py-1" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-stone-700">{n.body}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "Results" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-stone-600">Open rate = families who opened their note at least once ÷ notes sent. Each family counts once, however often they look.</p>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="thanks-results">
            {d.results.map((r) => (
              <div key={r.variant} className="rounded-xl border bg-white p-4">
                <p className="text-sm text-stone-500">Version {r.variant}</p>
                <p className="text-3xl font-bold">{pct(r.openRate)}</p>
                <p className="text-sm text-stone-600">
                  {r.opened} opened of {r.sent} sent · {r.drafts} drafts
                </p>
                <div className="mt-2 h-2 rounded bg-stone-100" aria-hidden>
                  <div className="h-2 rounded bg-rose-700" style={{ width: `${Math.round((r.openRate ?? 0) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {d.results.every((r) => r.sent < 20) && <p className="text-xs text-stone-500">With fewer than about 20 notes per version, differences are mostly chance.</p>}
        </section>
      )}
    </main>
  );
}
