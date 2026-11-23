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

export type AnnounceDeps = {
  voiceCallsOn: () => Promise<boolean>;
  client: Pick<SarvamClient, "tts">;
  cache: AudioCache;
  record: (r: TtsResult, seconds?: number) => void;
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
    deps.record("success", 0);
    return audio(hit);
  }
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  try {
    const r = await deps.client.tts(text, lang);
    deps.record("success", (now() - t0) / 1000);
    deps.cache.set(lang, text, r);
    return audio(r);
  } catch (e) {
    deps.record(e instanceof SarvamError && e.kind === "timeout" ? "timeout" : "failure");
    return noContent();
  }
}
