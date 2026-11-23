/**
 * Decide how the TV announces a call. Contract C3 (E2) serves the audio; anything other than
 * a timely audio response falls back to the bundled chime, and the queue never waits on TTS.
 */
export const AUDIO_TIMEOUT_MS = 3500;

export type AnnouncementOutcome =
  | { kind: "audio"; blob: Blob }
  | { kind: "chime"; reason: "timeout" | "error" | "not_audio" | "http" };

export async function fetchAnnouncement(
  announcementId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = AUDIO_TIMEOUT_MS,
  tvKey?: string,
): Promise<AnnouncementOutcome> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const qs = tvKey ? `?key=${encodeURIComponent(tvKey)}` : "";
    const res = await fetchImpl(`/api/tv/announcement/${encodeURIComponent(announcementId)}/audio${qs}`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.status !== 200) return { kind: "chime", reason: "http" };
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("audio/")) return { kind: "chime", reason: "not_audio" };
    const blob = await res.blob();
    if (blob.size === 0) return { kind: "chime", reason: "not_audio" };
    return { kind: "audio", blob };
  } catch {
    return { kind: "chime", reason: timedOut ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}
