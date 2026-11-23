/**
 * Contract C3 core, kept free of Next/DB so it is unit-testable:
 * voice_calls OFF → 204 immediately; cache hit → audio; else tts with a 3 s timeout,
 * success → audio + success metric, failure/timeout → 204 + failure/timeout metric.
 */
import { announcementText } from "./announcement";
import type { AudioCache } from "./audioCache";
import { SarvamError, type SarvamClient } from "./client";
import type { AppLanguage } from "./languages";
import type { TtsResult } from "@/lib/metrics";

export type TtsSource = "memory" | "storage" | "sarvam";

/** Persistent audio store (Supabase Storage bucket "tts"), filled by scripts/pregen-tts.ts. */
export type AudioStore = {
  get: (lang: AppLanguage, text: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
  put: (lang: AppLanguage, text: string, audio: { bytes: Uint8Array; contentType: string }) => Promise<void>;
};

export type AnnounceDeps = {
  voiceCallsOn: () => Promise<boolean>;
  client: Pick<SarvamClient, "tts">;
  cache: AudioCache;
  store?: AudioStore;
  record: (r: TtsResult, seconds?: number, source?: TtsSource) => void;
  now?: () => number;
};

export async function announcementAudio(token: number, lang: AppLanguage, deps: AnnounceDeps): Promise<Response> {
  const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (!(await deps.voiceCallsOn())) {
    deps.record("disabled");
    return noContent();
  }
  const text = announcementText(token, lang);
  const audio = (r: { bytes: Uint8Array; contentType: string }) =>
    new Response(r.bytes as BodyInit, { status: 200, headers: { "content-type": r.contentType, "cache-control": "private, max-age=3600" } });

  const hit = deps.cache.get(lang, text);
  if (hit) {
    deps.record("success", 0, "memory");
    return audio(hit);
  }
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const stored = deps.store ? await deps.store.get(lang, text).catch(() => null) : null;
  if (stored) {
    deps.cache.set(lang, text, stored);
    deps.record("success", (now() - t0) / 1000, "storage");
    return audio(stored);
  }
  try {
    const r = await deps.client.tts(text, lang);
    deps.record("success", (now() - t0) / 1000, "sarvam");
    deps.cache.set(lang, text, r);
    void deps.store?.put(lang, text, r).catch(() => {});
    return audio(r);
  } catch (e) {
    deps.record(e instanceof SarvamError && e.kind === "timeout" ? "timeout" : "failure");
    return noContent();
  }
}
