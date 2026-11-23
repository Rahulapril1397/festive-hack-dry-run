"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeQr, readCaptureMs } from "./exif";
import { pool, sha256Hex, withRetry } from "./upload";

type Ev = { id: string; name: string };
type Batch = { id: string; camera_name: string; clock_offset_ms: number | null };
type ItemState = "hashing" | "ready" | "uploading" | "done" | "already" | "failed";
type Item = { key: string; file: File; hash: string | null; ms: number | null; raw: string | null; state: ItemState; error?: string };

const PARALLEL = 3;
const fmt = (ms: number | null) => (ms == null ? "no EXIF time" : new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + `.${String(ms % 1000).padStart(3, "0")}`);

export function Uploader({ events }: { events: Ev[] }) {
  const [eventId, setEventId] = useState(events.at(-1)?.id ?? "");
  const [camera, setCamera] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [existingBatches, setExistingBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [cal, setCal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const count = (s: ItemState[]) => items.filter((i) => s.includes(i.state)).length;

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/photos/batches?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : { batches: [] }))
      .then((j) => setExistingBatches(j.batches ?? []))
      .catch(() => setExistingBatches([]));
  }, [eventId]);

  async function startBatch() {
    setMsg(null);
    const res = await fetch("/api/photos/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, cameraName: camera }) });
    const j = await res.json();
    if (!res.ok) return setMsg(j?.error?.message ?? "Could not create batch");
    setBatch(j);
  }

  async function pick(files: FileList | null) {
    if (!files) return;
    const imgs = [...files].filter((f) => /^image\/(jpeg|heic|heif|png)$/i.test(f.type) || /\.(jpe?g|heic)$/i.test(f.name));
    const fresh: Item[] = imgs.map((file) => ({ key: `${file.name}:${file.size}:${file.lastModified}`, file, hash: null, ms: null, raw: null, state: "hashing" }));
    setItems((cur) => [...cur, ...fresh.filter((f) => !cur.some((c) => c.key === f.key))]);
    await pool(fresh, 4, async (it) => {
      const [hash, exif] = await Promise.all([sha256Hex(it.file), readCaptureMs(it.file)]);
      patch(it.key, { hash, ms: exif.ms, raw: exif.raw, state: "ready" });
      it.hash = hash;
      it.ms = exif.ms;
    });
  }

  async function calibrate(file: File | undefined) {
    if (!file || !batch) return;
    setCal("Reading QR…");
    const [qrText, exif] = await Promise.all([decodeQr(file), readCaptureMs(file)]);
    if (!qrText) return setCal("No QR code found in that photo. Fill the frame with the stage QR and try again.");
    if (exif.ms == null) return setCal("That photo has no EXIF capture time; take it with the camera you are calibrating.");
    const res = await fetch(`/api/photos/batches/${batch.id}/calibrate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qrText, exifMs: exif.ms }) });
    const j = await res.json();
    if (!res.ok) return setCal(j?.error?.message ?? "Calibration failed");
    setBatch({ ...batch, clock_offset_ms: j.offsetMs });
    setCal(`Calibrated: camera is ${Math.abs(j.offsetMs / 1000).toFixed(2)} s ${j.offsetMs >= 0 ? "behind" : "ahead of"} the stage clock.`);
  }

  /** Upload everything not done: 3 in parallel, 3 tries each; files already in the batch are skipped by hash. */
  async function upload(only?: ItemState[]) {
    if (!batch) return;
    setBusy(true);
    setMsg(null);
    const todo = items.filter((i) => i.hash && (only ? only.includes(i.state) : ["ready", "failed"].includes(i.state)));
    // Ask once per 50 which files the batch already has, and get signed URLs for the rest.
    const urls = new Map<string, { path: string; signedUrl: string }>();
    for (let i = 0; i < todo.length; i += 50) {
      const chunk = todo.slice(i, i + 50);
      const res = await fetch(`/api/photos/batches/${batch.id}/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: chunk.map((c) => ({ name: c.file.name, hash: c.hash })) }) }).catch(() => null);
      if (!res?.ok) {
        setMsg("Could not reach the server; your files are kept — press Upload again.");
        setBusy(false);
        return;
      }
      const j = (await res.json()) as { uploads: { hash: string; path: string; signedUrl: string }[]; existing: string[] };
      for (const h of j.existing) chunk.filter((c) => c.hash === h).forEach((c) => patch(c.key, { state: "already" }));
      for (const u of j.uploads) urls.set(u.hash, u);
    }
    await pool(todo.filter((t) => urls.has(t.hash!)), PARALLEL, async (it) => {
      const u = urls.get(it.hash!)!;
      patch(it.key, { state: "uploading", error: undefined });
      try {
        await withRetry(async () => {
          const put = await fetch(u.signedUrl, { method: "PUT", headers: { "content-type": it.file.type || "image/jpeg", "x-upsert": "true" }, body: it.file });
          if (!put.ok) throw new Error(`storage ${put.status}`);
          const meta = await fetch(`/api/photos/batches/${batch.id}/photos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photos: [{ path: u.path, capturedAtMs: it.ms, contentHash: it.hash }] }) });
          if (!meta.ok) throw new Error(`metadata ${meta.status}`);
        });
        patch(it.key, { state: "done" });
      } catch (e) {
        patch(it.key, { state: "failed", error: (e as Error).message });
      }
    });
    setBusy(false);
  }

  if (!batch) {
    return (
      <section className="flex max-w-lg flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-semibold">1 · Batch</h2>
        {events.length === 0 ? (
          <p className="text-stone-500">No functions yet. A host creates them under Functions.</p>
        ) : (
          <>
            <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Function" data-testid="photo-event">
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input className="input" placeholder="Camera name (e.g. Canon R6 – Ravi)" value={camera} onChange={(e) => setCamera(e.target.value)} data-testid="camera-name" />
            <button className="btn-primary" disabled={!eventId || !camera.trim()} onClick={startBatch} data-testid="start-batch">Start new batch</button>
            {existingBatches.length > 0 && (
              <label className="text-sm">
                …or continue a batch:
                <select className="input mt-1" defaultValue="" onChange={(e) => { const b = existingBatches.find((x) => x.id === e.target.value); if (b) setBatch(b); }} data-testid="continue-batch">
                  <option value="" disabled>choose…</option>
                  {existingBatches.map((b) => <option key={b.id} value={b.id}>{b.camera_name} {b.clock_offset_ms != null ? "(calibrated)" : ""}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </section>
    );
  }

  const total = items.length;
  const finished = count(["done", "already"]);
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4" data-testid="calibration">
        <h2 className="font-semibold">2 · Clock calibration</h2>
        <p className="text-sm text-stone-600">With this camera, photograph the QR on the stage console&apos;s Clock calibration panel, then choose that photo here.</p>
        <input type="file" accept="image/*" onChange={(e) => calibrate(e.target.files?.[0])} data-testid="calibration-file" />
        <p className={`text-sm ${batch.clock_offset_ms == null ? "text-amber-700" : "text-green-700"}`} data-testid="offset-status">
          {cal ?? (batch.clock_offset_ms == null ? "Not calibrated yet — matching waits for calibration." : `Offset ${batch.clock_offset_ms} ms`)}
        </p>
        <p className="text-xs text-stone-500">
          Batch for <b>{batch.camera_name}</b>. <button className="underline" onClick={() => (setBatch(null), setItems([]), setCal(null))}>Change batch</button>
        </p>
        <Link className="btn-secondary" href={`/photographer/review?event=${eventId}`}>Review matches →</Link>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-semibold">3 · Upload photos</h2>
        <p className="text-xs text-stone-500">After a reload or a dropped connection, choose the same files again: ones already uploaded are recognised and skipped.</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="btn-secondary cursor-pointer">
            Choose files
            <input type="file" accept="image/jpeg,image/heic,.jpg,.jpeg" multiple hidden onChange={(e) => pick(e.target.files)} data-testid="photo-files" />
          </label>
          <label className="btn-secondary cursor-pointer">
            Choose folder
            <input type="file" multiple hidden onChange={(e) => pick(e.target.files)} {...({ webkitdirectory: "" } as Record<string, string>)} />
          </label>
          <button className="btn-primary" disabled={busy || !items.some((i) => i.state === "ready")} onClick={() => upload(["ready"])} data-testid="upload">
            {busy ? "Uploading…" : "Upload"}
          </button>
          {count(["failed"]) > 0 && !busy && (
            <button className="btn-secondary" onClick={() => upload(["failed"])} data-testid="retry-failed">Retry {count(["failed"])} failed</button>
          )}
        </div>
        {total > 0 && (
          <>
            <div className="h-2 overflow-hidden rounded bg-stone-200" aria-label="progress">
              <div className="h-full bg-rose-600 transition-all" style={{ width: `${(finished / total) * 100}%` }} />
            </div>
            <p className="text-sm" data-testid="upload-count">
              {finished} of {total} uploaded{count(["already"]) ? ` (${count(["already"])} were already there)` : ""}{count(["failed"]) ? ` · ${count(["failed"])} failed` : ""}
            </p>
            <ul className="max-h-96 divide-y overflow-auto text-sm">
              {items.map((it) => (
                <li key={it.key} className="flex items-center justify-between gap-2 py-1">
                  <span className="truncate">{it.file.name}</span>
                  <span className="font-mono text-xs text-stone-600" title={it.raw ?? undefined}>{fmt(it.ms)}</span>
                  <span className={`text-xs ${it.state === "done" || it.state === "already" ? "text-green-700" : it.state === "failed" ? "text-red-700" : "text-stone-500"}`} title={it.error}>
                    {it.state === "already" ? "already uploaded" : it.state}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </section>
    </div>
  );
}
