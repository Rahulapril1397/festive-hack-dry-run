import { describe, expect, it, vi } from "vitest";
import { announcementAudio } from "@/lib/sarvam/announce";
import { AudioCache } from "@/lib/sarvam/audioCache";
import { createSarvamClient, SarvamError } from "@/lib/sarvam/client";

const wav = { bytes: new Uint8Array([82, 73, 70, 70]), contentType: "audio/wav" };

function deps(over: Partial<Parameters<typeof announcementAudio>[2]> = {}) {
  const record = vi.fn();
  return {
    record,
    d: { voiceCallsOn: async () => true, client: { tts: vi.fn(async () => wav) }, cache: new AudioCache(), record, ...over },
  };
}

describe("C3 announcement audio", () => {
  it("success → 200 audio/*, success metric with latency", async () => {
    const { d, record } = deps();
    const res = await announcementAudio(7, "en", d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(record).toHaveBeenCalledWith("success", expect.any(Number));
  });

  it("repeat is served from the (language, text) cache", async () => {
    const { d } = deps();
    await announcementAudio(7, "hi", d);
    await announcementAudio(7, "hi", d);
    expect(d.client.tts).toHaveBeenCalledTimes(1);
  });

  it("SARVAM_FORCE_FAIL → 204 + failure metric", async () => {
    const { d, record } = deps({ client: createSarvamClient({ forceFail: true }) });
    expect((await announcementAudio(7, "en", d)).status).toBe(204);
    expect(record).toHaveBeenCalledWith("failure");
  });

  it("Sarvam mock timeout → 204 + timeout metric", async () => {
    const { d, record } = deps({ client: { tts: async () => Promise.reject(new SarvamError("timeout", "t")) } });
    expect((await announcementAudio(7, "en", d)).status).toBe(204);
    expect(record).toHaveBeenCalledWith("timeout");
  });

  it("voice_calls OFF → 204 immediately, Sarvam never called", async () => {
    const { d, record } = deps({ voiceCallsOn: async () => false });
    expect((await announcementAudio(7, "en", d)).status).toBe(204);
    expect(d.client.tts).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith("disabled");
  });

  it("T6 check: 5 forced failures show as 5 failures in the metric text", async () => {
    const { metrics, recordTts } = await import("@/lib/metrics");
    const before = await metrics.ttsRequests.get();
    const failBefore = before.values.find((v) => v.labels.result === "failure")?.value ?? 0;
    const d = { voiceCallsOn: async () => true, client: createSarvamClient({ forceFail: true }), cache: new AudioCache(), record: recordTts };
    for (let i = 0; i < 5; i++) await announcementAudio(i + 1, "en", d);
    const after = await metrics.ttsRequests.get();
    expect(after.values.find((v) => v.labels.result === "failure")!.value - failBefore).toBe(5);
    const text = await metrics.registry.metrics();
    for (const line of text.split("\n").filter((l) => l.startsWith("pehle_tts"))) {
      expect(line).toMatch(/^pehle_tts_[a-z_]+(\{(result|reason|le)="[a-z_.+0-9Inf]+"\})? [0-9.e+-]+$/);
    }
  });
});
