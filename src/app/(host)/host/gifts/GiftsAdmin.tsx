"use client";

import { useState } from "react";
import type { HostGift } from "@/domain/gifts/service";
import { api } from "@/components/shell/api";

export function GiftsAdmin({ initial, priceLabels }: { initial: HostGift[]; priceLabels: Record<string, string> }) {
  const [gifts, setGifts] = useState(initial);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const reload = async () => setGifts((await api<{ gifts: HostGift[] }>("/api/host/gifts")).gifts);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  };
  const claimed = gifts.reduce((n, g) => n + g.claims.length, 0);
  const received = gifts.reduce((n, g) => n + g.claims.filter((c) => c.status === "fulfilled").length, 0);

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Gift wishlist</h1>
          <p className="text-sm text-stone-600">
            {gifts.length} gifts · {claimed} chosen by families · {received} received. Guests only see what is still available, never who chose what.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing("new")} data-testid="add-gift">
          Add gift
        </button>
      </div>
      {msg && <p className={`rounded p-2 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{msg.text}</p>}
      {editing === "new" && <GiftForm priceLabels={priceLabels} onCancel={() => setEditing(null)} onSave={(body) => run(async () => (await api("/api/host/gifts", { method: "POST", body }), setEditing(null)), "Gift added")} />}
      <ul className="flex flex-col gap-3" data-testid="host-gift-list">
        {gifts.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-stone-500">No gifts yet. Add what the couple would love — families can then pick one from their link.</li>}
        {gifts.map((g) => (
          <li key={g.id} className="rounded-xl border bg-white p-4">
            {editing === g.id ? (
              <GiftForm priceLabels={priceLabels} initial={g} onCancel={() => setEditing(null)} onSave={(body) => run(async () => (await api(`/api/host/gifts/${g.id}`, { method: "PATCH", body }), setEditing(null)), "Gift saved")} />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                {g.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket
                  <img src={g.imageUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
                ) : (
                  <ImageUpload giftId={g.id} onDone={() => run(async () => {}, "Picture added")} onError={(t) => setMsg({ kind: "err", text: t })} />
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{g.title}</b>
                    {g.status === "hidden" && <span className="rounded bg-stone-200 px-2 text-xs">hidden</span>}
                    {g.priceBand && <span className="rounded bg-stone-100 px-2 text-xs">{priceLabels[g.priceBand]}</span>}
                    <span className={`text-xs ${g.remaining === 0 ? "font-semibold text-green-800" : "text-stone-500"}`}>
                      {g.quantity - g.remaining} of {g.quantity} chosen
                    </span>
                    <span className="flex-1" />
                    <button className="text-sm underline" onClick={() => setEditing(g.id)}>
                      Edit
                    </button>
                  </div>
                  {g.description && <p className="text-sm text-stone-600">{g.description}</p>}
                  {g.claims.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {g.claims.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2">
                          <span>
                            {c.familyName}
                            {c.quantity > 1 ? ` ×${c.quantity}` : ""}
                          </span>
                          <label className="flex items-center gap-1 text-xs text-stone-600">
                            <input type="checkbox" checked={c.status === "fulfilled"} onChange={(e) => run(() => api(`/api/host/gifts/claims/${c.id}/fulfil`, { method: "POST", body: { fulfilled: e.target.checked } }), e.target.checked ? "Marked received" : "Marked not received")} />
                            received
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

function GiftForm({ initial, priceLabels, onSave, onCancel }: { initial?: HostGift; priceLabels: Record<string, string>; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      data-testid="gift-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          title: f.get("title"),
          description: f.get("description") ?? "",
          link: f.get("link") ?? "",
          priceBand: f.get("priceBand") ?? "",
          quantity: Number(f.get("quantity") || 1),
          status: f.get("hidden") ? "hidden" : "active",
        });
      }}
    >
      <input name="title" required minLength={2} maxLength={120} defaultValue={initial?.title} className="input !text-base" placeholder="Gift (e.g. Dinner set)" aria-label="Title" />
      <input name="link" type="url" defaultValue={initial?.link ?? ""} className="input !text-base" placeholder="Shop link (optional)" aria-label="Link" />
      <textarea name="description" maxLength={1000} defaultValue={initial?.description ?? ""} className="input !text-base sm:col-span-2" rows={2} placeholder="Notes for guests (colour, size…)" aria-label="Description" />
      <select name="priceBand" defaultValue={initial?.priceBand ?? ""} className="input !text-base" aria-label="Price band">
        <option value="">Price band (optional)</option>
        {Object.entries(priceLabels).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        How many
        <input name="quantity" type="number" min={1} max={50} defaultValue={initial?.quantity ?? 1} className="input w-24 !text-base" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="hidden" type="checkbox" defaultChecked={initial?.status === "hidden"} /> Hide from guests
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary !py-1.5">Save</button>
        <button type="button" className="btn-secondary !py-1.5" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ImageUpload({ giftId, onDone, onError }: { giftId: string; onDone: () => void; onError: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border border-dashed text-center text-xs text-stone-500 ${busy ? "opacity-50" : "hover:border-rose-300"}`}>
      {busy ? "Uploading…" : "+ Picture"}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) return onError("Pictures up to 5 MB, please.");
          setBusy(true);
          try {
            const u = await api<{ path: string; uploadUrl: string }>(`/api/host/gifts/${giftId}/image`, { method: "POST", body: { contentType: file.type } });
            const put = await fetch(u.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
            if (!put.ok) throw new Error("Upload failed");
            await api(`/api/host/gifts/${giftId}`, { method: "PATCH", body: { imagePath: u.path } });
            onDone();
          } catch (x) {
            onError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}
