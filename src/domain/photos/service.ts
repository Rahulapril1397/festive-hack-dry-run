import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, getEvent, rpc } from "@/lib/db/service";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { verifyClockQr } from "@/lib/clock";
import type { Session } from "@/lib/authz";
import { clockOffsetMs } from "./time";
import { DEFAULT_WINDOW_MS, matchPhoto, type Bucket } from "./match";

export const BUCKET = "photos";
const THUMB_TTL_S = 120;

export const NewBatch = z.object({ eventId: z.string().uuid(), cameraName: z.string().trim().min(1).max(60) });
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
export const UploadRequest = z.object({ files: z.array(z.object({ name: z.string().min(1).max(200), hash: Hash.optional() })).min(1).max(200) });
export const PhotoMeta = z.object({
  photos: z.array(z.object({ path: z.string().min(1).max(400), capturedAtMs: z.number().int().nullable(), contentHash: Hash.optional() })).min(1).max(200),
});
export const Calibration = z.object({ qrText: z.string().min(10).max(200), exifMs: z.number().int() });

type BatchRow = { id: string; event_id: string; camera_name: string; clock_offset_ms: number | null; calibrated_at: string | null; uploaded_at: string };

/** Load a batch and check it belongs to the caller's wedding. */
export async function batchFor(s: Session, batchId: string): Promise<BatchRow & { weddingId: string }> {
  if (!z.string().uuid().safeParse(batchId).success) throw new AppError("NOT_FOUND");
  const { data } = await db().from("batch").select("id, event_id, camera_name, clock_offset_ms, calibrated_at, uploaded_at").eq("id", batchId).maybeSingle();
  if (!data) throw new AppError("NOT_FOUND");
  const ev = await getEvent(data.event_id);
  if (ev.wedding_id !== s.weddingId) throw new AppError("NOT_FOUND");
  return { ...(data as BatchRow), weddingId: ev.wedding_id };
}

export async function createBatch(s: Session, input: z.infer<typeof NewBatch>) {
  const ev = await getEvent(input.eventId);
  if (ev.wedding_id !== s.weddingId) throw new AppError("EVENT_NOT_FOUND");
  const { data, error } = await db()
    .from("batch")
    .insert({ event_id: ev.id, photographer_user_id: s.userId, camera_name: input.cameraName })
    .select("id, event_id, camera_name, clock_offset_ms")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);

/** Signed URLs for files not already in the batch (matched by SHA-256 content hash → resumable, no duplicates). */
export async function signedUploads(s: Session, batchId: string, files: { name: string; hash?: string }[]) {
  const b = await batchFor(s, batchId);
  const hashes = files.flatMap((f) => (f.hash ? [f.hash] : []));
  const { data: have } = hashes.length ? await db().from("photo").select("content_hash").eq("batch_id", b.id).in("content_hash", hashes) : { data: [] };
  const existing = new Set((have ?? []).map((r) => r.content_hash as string));
  const uploads = await Promise.all(
    files.filter((f) => !f.hash || !existing.has(f.hash)).map(async (f) => {
      const path = `${b.event_id}/${b.id}/${randomUUID()}-${safeName(f.name)}`;
      const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new Error(`signed upload failed: ${error?.message}`);
      return { name: f.name, hash: f.hash ?? null, path, signedUrl: data.signedUrl, token: data.token };
    }),
  );
  return { uploads, existing: [...existing] };
}

/** Store raw capture times (never overwritten), then match. Paths must be inside this batch. */
export async function recordPhotos(s: Session, batchId: string, photos: z.infer<typeof PhotoMeta>["photos"]) {
  const b = await batchFor(s, batchId);
  const prefix = `${b.event_id}/${b.id}/`;
  if (photos.some((p) => !p.path.startsWith(prefix) || p.path.includes(".."))) throw new AppError("BAD_REQUEST", "Path outside batch");
  const hashes = photos.flatMap((p) => (p.contentHash ? [p.contentHash] : []));
  const { data: have } = hashes.length ? await db().from("photo").select("content_hash").eq("batch_id", b.id).in("content_hash", hashes) : { data: [] };
  const existing = new Set((have ?? []).map((r) => r.content_hash as string));
  const rows = photos
    .filter((p) => !p.contentHash || !existing.has(p.contentHash))
    .map((p) => {
      const captured = p.capturedAtMs == null ? null : new Date(p.capturedAtMs);
      const corrected = captured && b.clock_offset_ms != null ? new Date(captured.getTime() + Number(b.clock_offset_ms)) : null;
      return { batch_id: b.id, storage_path: p.path, content_hash: p.contentHash ?? null, captured_at: captured?.toISOString() ?? null, corrected_at: corrected?.toISOString() ?? null };
    });
  if (!rows.length) return { stored: 0 };
  const { error } = await db().from("photo").upsert(rows, { onConflict: "storage_path", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await runMatching(b.id);
  return { stored: rows.length };
}

/** Verify the stage QR server-side (C4), save the offset, recompute corrected_at, re-match. */
export async function calibrate(s: Session, batchId: string, input: z.infer<typeof Calibration>) {
  const b = await batchFor(s, batchId);
  const qrMs = verifyClockQr(input.qrText, env().CLOCK_HMAC_SECRET);
  if (qrMs == null) throw new AppError("BAD_REQUEST", "That QR is not a valid Pehle Aap clock code");
  const offset = clockOffsetMs(qrMs, input.exifMs);
  if (Math.abs(offset) > 24 * 3600_000) throw new AppError("BAD_REQUEST", "Camera clock is more than a day off; set the date first");
  await rpc("photo_calibrate", { p_batch: b.id, p_actor: s.userId, p_offset_ms: offset });
  await runMatching(b.id);
  return { offsetMs: offset };
}

async function windowFor(weddingId: string) {
  const { data } = await db().from("wedding").select("photo_match_window_ms").eq("id", weddingId).maybeSingle();
  return data?.photo_match_window_ms ?? (Number(process.env.PHOTO_MATCH_WINDOW_MS) || DEFAULT_WINDOW_MS);
}

export async function runMatching(batchId: string) {
  const { data: b } = await db().from("batch").select("id, event_id, event:event_id(wedding_id)").eq("id", batchId).single();
  if (!b) return;
  const weddingId = (b.event as unknown as { wedding_id: string }).wedding_id;
  const windowMs = await windowFor(weddingId);
  const { data: photos } = await db().from("photo").select("id, corrected_at, review_status").eq("batch_id", batchId).neq("review_status", "matched");
  const timed = (photos ?? []).filter((p) => p.corrected_at);
  if (!timed.length) return;
  const times = timed.map((p) => new Date(p.corrected_at!).getTime());
  const { data: logs } = await db()
    .from("stage_log")
    .select("id, action, created_at, queue_entry_id, token_number")
    .eq("event_id", b.event_id)
    .in("action", ["called", "on_stage"])
    .gte("created_at", new Date(Math.min(...times) - windowMs).toISOString())
    .lte("created_at", new Date(Math.max(...times) + windowMs).toISOString());
  const lite = (logs ?? []).map((l) => ({ id: l.id, action: l.action, createdMs: new Date(l.created_at).getTime(), queueEntryId: l.queue_entry_id, token: l.token_number }));
  for (const p of timed) {
    const c = matchPhoto(new Date(p.corrected_at!).getTime(), lite, windowMs);
    await rpc("photo_set_candidates", { p_photo: p.id, p_candidates: c.map((x) => ({ stageLogId: x.stageLogId, deltaMs: x.deltaMs })) });
  }
}

export type ReviewItem = {
  id: string;
  thumbUrl: string | null;
  capturedAt: string | null;
  correctedAt: string | null;
  status: Bucket;
  camera: string;
  matchedToken: number | null;
  candidates: { id: string; token: number | null; action: string; deltaMs: number; calledAt: string }[];
};

export const REVIEW_PAGE = 30;

export async function reviewList(s: Session, eventId: string, opts: { bucket?: Bucket; page?: number } = {}): Promise<ReviewItem[]> {
  const ev = await getEvent(eventId);
  if (ev.wedding_id !== s.weddingId) throw new AppError("EVENT_NOT_FOUND");
  const { data: photos, error } = await db()
    .from("photo")
    .select("id, storage_path, captured_at, corrected_at, review_status, family:family_id(token_number), batch:batch_id!inner(event_id, camera_name), photo_candidate(id, delta_ms, decision, stage_log:stage_log_id(action, token_number, created_at))")
    .eq("batch.event_id", eventId)
    .match(opts.bucket ? { review_status: opts.bucket } : {})
    .order("corrected_at", { ascending: true, nullsFirst: false })
    .range((opts.page ?? 0) * REVIEW_PAGE, (opts.page ?? 0) * REVIEW_PAGE + REVIEW_PAGE - 1);
  if (error) throw new Error(error.message);
  const paths = (photos ?? []).map((p) => p.storage_path);
  const signed = paths.length ? (await db().storage.from(BUCKET).createSignedUrls(paths, THUMB_TTL_S)).data ?? [] : [];
  const urlFor = new Map(signed.map((x) => [x.path, x.signedUrl]));
  type Cand = { id: string; delta_ms: number; decision: string; stage_log: { action: string; token_number: number | null; created_at: string } | null };
  return (photos ?? []).map((p) => ({
    id: p.id,
    thumbUrl: urlFor.get(p.storage_path) ?? null,
    capturedAt: p.captured_at,
    correctedAt: p.corrected_at,
    status: p.review_status as Bucket,
    camera: (p.batch as unknown as { camera_name: string }).camera_name,
    matchedToken: (p.family as unknown as { token_number: number | null } | null)?.token_number ?? null,
    candidates: ((p.photo_candidate ?? []) as unknown as Cand[])
      .filter((c) => c.decision === "pending" && c.stage_log)
      .sort((a, b) => Math.abs(a.delta_ms) - Math.abs(b.delta_ms))
      .map((c) => ({ id: c.id, token: c.stage_log!.token_number, action: c.stage_log!.action, deltaMs: c.delta_ms, calledAt: c.stage_log!.created_at })),
  }));
}

/** Bucket counts for the whole event (the list itself is paged). */
export async function reviewCounts(s: Session, eventId: string): Promise<Record<Bucket, number>> {
  const ev = await getEvent(eventId);
  if (ev.wedding_id !== s.weddingId) throw new AppError("EVENT_NOT_FOUND");
  const { data } = await db().from("photo").select("review_status, batch:batch_id!inner(event_id)").eq("batch.event_id", eventId);
  const out: Record<Bucket, number> = { matched: 0, check: 0, unmatched: 0 };
  for (const p of data ?? []) out[p.review_status as Bucket]++;
  return out;
}

export async function decide(s: Session, candidateId: string, decision: "confirmed" | "rejected") {
  if (!z.string().uuid().safeParse(candidateId).success) throw new AppError("NOT_FOUND");
  const { data } = await db().from("photo_candidate").select("id, stage_log:stage_log_id(event:event_id(wedding_id))").eq("id", candidateId).maybeSingle();
  const wedding = (data?.stage_log as unknown as { event: { wedding_id: string } } | null)?.event?.wedding_id;
  if (!data || wedding !== s.weddingId) throw new AppError("NOT_FOUND");
  return rpc<{ id: string; review_status: Bucket }>("photo_decide", { p_candidate: candidateId, p_actor: s.userId, p_decision: decision });
}

/** Host album: confirmed photos grouped by family token. */
export async function album(s: Session) {
  const { data, error } = await db()
    .from("photo")
    .select("id, storage_path, corrected_at, family:family_id!inner(token_number, wedding_id)")
    .eq("review_status", "matched")
    .eq("family.wedding_id", s.weddingId)
    .order("corrected_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const paths = (data ?? []).map((p) => p.storage_path);
  const signed = paths.length ? (await db().storage.from(BUCKET).createSignedUrls(paths, THUMB_TTL_S)).data ?? [] : [];
  const urlFor = new Map(signed.map((x) => [x.path, x.signedUrl]));
  const groups = new Map<number, { id: string; url: string | null }[]>();
  for (const p of data ?? []) {
    const token = (p.family as unknown as { token_number: number }).token_number;
    groups.set(token, [...(groups.get(token) ?? []), { id: p.id, url: urlFor.get(p.storage_path) ?? null }]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([token, photos]) => ({ token, photos }));
}

export async function batchesFor(s: Session, eventId: string) {
  const ev = await getEvent(eventId);
  if (ev.wedding_id !== s.weddingId) throw new AppError("EVENT_NOT_FOUND");
  const { data } = await db().from("batch").select("id, camera_name, clock_offset_ms, calibrated_at, uploaded_at, photo(count)").eq("event_id", eventId).order("uploaded_at", { ascending: false });
  return data ?? [];
}

/**
 * One family's own album: only photos a person confirmed for THIS family, grouped by function
 * (in function order), with short-lived picture links. Never reads any other family's photos.
 */
export async function familyAlbum(familyId: string): Promise<{ eventId: string; eventName: string; photos: { id: string; url: string }[] }[]> {
  const { data, error } = await db()
    .from("photo")
    .select("id, storage_path, corrected_at, batch:batch_id!inner(event:event_id!inner(id, name, starts_at))")
    .eq("family_id", familyId)
    .eq("review_status", "matched")
    .order("corrected_at", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { id: string; storage_path: string; batch: { event: { id: string; name: string; starts_at: string | null } } }[];
  const paths = rows.map((r) => r.storage_path);
  const signed = paths.length ? (await db().storage.from(BUCKET).createSignedUrls(paths, THUMB_TTL_S)).data ?? [] : [];
  const urlFor = new Map(signed.map((x) => [x.path, x.signedUrl]));
  const groups = new Map<string, { eventId: string; eventName: string; startsAt: string; photos: { id: string; url: string }[] }>();
  for (const r of rows) {
    const url = urlFor.get(r.storage_path);
    if (!url) continue;
    const ev = r.batch.event;
    const g = groups.get(ev.id) ?? { eventId: ev.id, eventName: ev.name, startsAt: ev.starts_at ?? "9999", photos: [] };
    g.photos.push({ id: r.id, url });
    groups.set(ev.id, g);
  }
  return [...groups.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(({ eventId, eventName, photos }) => ({ eventId, eventName, photos }));
}
