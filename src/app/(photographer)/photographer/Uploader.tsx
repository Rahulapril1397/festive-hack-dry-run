"use client";

import { useState } from "react";
import Link from "next/link";
import { decodeQr, readCaptureMs } from "./exif";

type Ev = { id: string; name: string };
type Batch = { id: string; camera_name: string; clock_offset_ms: number | null };
type Item = { file: File; ms: number | null; raw: string | null; state: "ready" | "uploading" | "done" | "error" };

const fmt = (ms: number | null) => (ms == null ? "no EXIF time" : new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + `.${String(ms % 1000).padStart(3, "0")}`);
const CHUNK = 20;

export function Uploader({ events }: { events: Ev[] }) {
  const [eventId, setEventId] = useState(events.at(-1)?.id ?? "");
  const [camera, setCamera] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [cal, setCal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = items.filter((i) => i.state === "done").length;

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
    const read = await Promise.all(imgs.map(async (file) => ({ file, ...(await readCaptureMs(file)), state: "ready" as const })));
    setItems((cur) => [...cur, ...read]);
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
    const s = Math.abs(j.offsetMs / 1000).toFixed(2);
    setCal(`Calibrated: camera is ${s} s ${j.offsetMs >= 0 ? "behind" : "ahead of"} the stage clock.`);
  }

  async function upload() {
    if (!batch) return;
    setBusy(true);
    const todo = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.state !== "done");
    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      setItems((cur) => cur.map((x, k) => (chunk.some((c) => c.idx === k) ? { ...x, state: "uploading" } : x)));
      const res = await fetch(`/api/photos/batches/${batch.id}/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: chunk.map((c) => ({ name: c.it.file.name })) }) });
      if (!res.ok) {
        setMsg("Could not get upload URLs");
        break;
      }
      const { uploads } = (await res.json()) as { uploads: { path: string; signedUrl: string }[] };
      const results = await Promise.all(
        chunk.map(async (c, k) => {
          const u = uploads[k]!;
          const put = await fetch(u.signedUrl, { method: "PUT", headers: { "content-type": c.it.file.type || "image/jpeg", "x-upsert": "false" }, body: c.it.file }).catch(() => null);
          return { idx: c.idx, ok: !!put?.ok, path: u.path, ms: c.it.ms };
        }),
      );
      const ok = results.filter((r) => r.ok);
      if (ok.length) {
        const meta = await fetch(`/api/photos/batches/${batch.id}/photos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photos: ok.map((r) => ({ path: r.path, capturedAtMs: r.ms })) }) });
        if (!meta.ok) ok.forEach((r) => (r.ok = false));
      }
      setItems((cur) => cur.map((x, k) => { const r = results.find((q) => q.idx === k); return r ? { ...x, state: r.ok ? "done" : "error" } : x; }));
    }
    setBusy(false);
  }

  if (!batch) {
    return (
      <section className="flex max-w-lg flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-semibold">1 · New batch</h2>
        <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Function" data-testid="photo-event">
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Camera name (e.g. Canon R6 – Ravi)" value={camera} onChange={(e) => setCamera(e.target.value)} data-testid="camera-name" />
        <button className="btn-primary" disabled={!eventId || !camera.trim()} onClick={startBatch} data-testid="start-batch">
          Start batch
        </button>
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </section>
    );
  }

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
          Batch for <b>{batch.camera_name}</b>. <button className="underline" onClick={() => (setBatch(null), setItems([]), setCal(null))}>New batch</button>
        </p>
        <Link className="btn-secondary" href={`/photographer/review?event=${eventId}`}>
          Review matches →
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-semibold">3 · Upload photos</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="btn-secondary cursor-pointer">
            Choose files
            <input type="file" accept="image/jpeg,image/heic,.jpg,.jpeg" multiple hidden onChange={(e) => pick(e.target.files)} data-testid="photo-files" />
          </label>
          <label className="btn-secondary cursor-pointer">
            Choose folder
            <input type="file" multiple hidden onChange={(e) => pick(e.target.files)} {...({ webkitdirectory: "" } as Record<string, string>)} />
          </label>
          <button className="btn-primary" disabled={busy || !items.some((i) => i.state !== "done")} onClick={upload} data-testid="upload">
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
        {items.length > 0 && (
          <>
            <div className="h-2 overflow-hidden rounded bg-stone-200" aria-label="progress">
              <div className="h-full bg-rose-600 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
            </div>
            <p className="text-sm" data-testid="upload-count">
              {done} of {items.length} uploaded
            </p>
            <ul className="max-h-96 divide-y overflow-auto text-sm">
              {items.map((it, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1">
                  <span className="truncate">{it.file.name}</span>
                  <span className="font-mono text-xs text-stone-600" title={it.raw ?? undefined}>
                    {fmt(it.ms)}
                  </span>
                  <span className={`text-xs ${it.state === "done" ? "text-green-700" : it.state === "error" ? "text-red-700" : "text-stone-500"}`}>{it.state}</span>
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
