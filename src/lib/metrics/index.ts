/**
 * Prometheus metrics (prom-client). Labels are fixed enums only — never family data.
 * Registry lives on globalThis so dev hot-reload does not double-register.
 */
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const TTS_RESULTS = ["success", "failure", "timeout", "disabled"] as const;
export type TtsResult = (typeof TTS_RESULTS)[number];
export const CHIME_REASONS = ["timeout", "error", "not_audio", "http", "play_failed", "other"] as const;
export type ChimeReason = (typeof CHIME_REASONS)[number];

function build() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "pehle_" });
  const ttsRequests = new Counter({
    name: "pehle_tts_requests_total",
    help: "TTS announcement requests by result",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const ttsLatency = new Histogram({
    name: "pehle_tts_latency_seconds",
    help: "Latency of successful Sarvam TTS calls",
    buckets: [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5],
    registers: [registry],
  });
  const chime = new Counter({
    name: "pehle_tts_fallback_chime_total",
    help: "TV played the local chime instead of TTS audio",
    labelNames: ["reason"] as const,
    registers: [registry],
  });
  // Pre-create series at 0 so dashboards and alerts see them before the first event.
  TTS_RESULTS.forEach((r) => ttsRequests.inc({ result: r }, 0));
  CHIME_REASONS.forEach((r) => chime.inc({ reason: r }, 0));
  return { registry, ttsRequests, ttsLatency, chime };
}

const g = globalThis as unknown as { __pehleMetrics?: ReturnType<typeof build> };
export const metrics = (g.__pehleMetrics ??= build());

export function recordTts(result: TtsResult, seconds?: number) {
  metrics.ttsRequests.inc({ result });
  if (result === "success" && seconds !== undefined) metrics.ttsLatency.observe(seconds);
}

export function recordChime(reason: string) {
  const r = (CHIME_REASONS as readonly string[]).includes(reason) ? (reason as ChimeReason) : "other";
  metrics.chime.inc({ reason: r });
}
