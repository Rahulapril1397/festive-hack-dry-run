/**
 * Time-based matching of photos to stage calls. No face recognition, never auto-confirms.
 * For each queue entry, prefer its on_stage log when inside the window, else its called log;
 * candidates are ranked by |delta|. The window is inclusive: |delta| <= windowMs.
 */
export type StageLogLite = { id: string; action: string; createdMs: number; queueEntryId: string | null; token: number | null };
export type Candidate = { stageLogId: string; deltaMs: number; action: "on_stage" | "called"; token: number | null; queueEntryId: string | null };

export const DEFAULT_WINDOW_MS = 3000;

export function matchPhoto(correctedMs: number, logs: StageLogLite[], windowMs = DEFAULT_WINDOW_MS): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const l of logs) {
    if (l.action !== "on_stage" && l.action !== "called") continue;
    const deltaMs = l.createdMs - correctedMs;
    if (Math.abs(deltaMs) > windowMs) continue;
    const key = l.queueEntryId ?? l.id;
    const c: Candidate = { stageLogId: l.id, deltaMs, action: l.action, token: l.token, queueEntryId: l.queueEntryId };
    const cur = best.get(key);
    if (!cur || better(c, cur)) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs) || a.stageLogId.localeCompare(b.stageLogId));
}

function better(a: Candidate, b: Candidate) {
  if (a.action !== b.action) return a.action === "on_stage";
  return Math.abs(a.deltaMs) < Math.abs(b.deltaMs);
}

export type Bucket = "matched" | "check" | "unmatched";
export const BUCKET_LABEL: Record<Bucket, string> = { matched: "Matched", check: "Check this", unmatched: "Unmatched" };

export function countBuckets(statuses: Bucket[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = { matched: 0, check: 0, unmatched: 0 };
  for (const s of statuses) out[s]++;
  return out;
}
