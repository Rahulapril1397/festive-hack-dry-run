import { describe, expect, it, vi } from "vitest";
import { createSarvamClient, SarvamError } from "@/lib/sarvam/client";
import { announcementText } from "@/lib/sarvam/announcement";
import { metrics, recordChime, recordTts } from "@/lib/metrics";

describe("announcementText", () => {
  it("English and Hindi, token only", () => {
    expect(announcementText(12, "en")).toBe("Token number 12, please come to the stage.");
    expect(announcementText(12, "hi")).toContain("12");
    expect(announcementText(12, "hi")).toContain("मंच");
  });
  it("rejects non-tokens", () => {
    expect(() => announcementText(0, "en")).toThrow();
    expect(() => announcementText(1.5, "en")).toThrow();
  });
});

describe("Sarvam client", () => {
  it("mock mode: translate is identity, tts returns WAV", async () => {
    const c = createSarvamClient({ apiKey: "" });
    expect(await c.translate("Hello", "hi")).toBe("Hello");
    const a = await c.tts("x", "en");
    expect(a.contentType).toBe("audio/wav");
    expect(Buffer.from(a.bytes.slice(0, 4)).toString()).toBe("RIFF");
  });

  it("SARVAM_FORCE_FAIL makes tts throw", async () => {
    await expect(createSarvamClient({ forceFail: true }).tts("x", "en")).rejects.toMatchObject({ kind: "forced" });
  });

  it("sends the documented request and decodes audios[0]", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ audios: [Buffer.from("RIFFdata").toString("base64")] }))) as unknown as typeof fetch;
    const c = createSarvamClient({ apiKey: "k", fetchImpl: f });
    const a = await c.tts("Token number 3", "hi");
    expect(Buffer.from(a.bytes).toString()).toBe("RIFFdata");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.sarvam.ai/text-to-speech");
    expect((init as RequestInit).headers).toMatchObject({ "api-subscription-key": "k" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ text: "Token number 3", language_code: "hi-IN" });
  });

  it("times out after the configured limit", async () => {
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as unknown as typeof fetch;
    const c = createSarvamClient({ apiKey: "k", fetchImpl: hang, timeoutMs: 30 });
    const err = await c.tts("x", "en").catch((e) => e);
    expect(err).toBeInstanceOf(SarvamError);
    expect(err.kind).toBe("timeout");
  });

  it("translate posts en-IN → hi-IN", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ translated_text: "नमस्ते" }))) as unknown as typeof fetch;
    expect(await createSarvamClient({ apiKey: "k", fetchImpl: f }).translate("Hello", "hi")).toBe("नमस्ते");
    const body = JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ input: "Hello", source_language_code: "en-IN", target_language_code: "hi-IN" });
  });
});

describe("metrics", () => {
  it("labels are fixed enums; unknown chime reasons collapse to 'other'", async () => {
    recordTts("failure");
    recordChime("Sharma family"); // must never become a label
    const text = await metrics.registry.metrics();
    expect(text).toContain('pehle_tts_requests_total{result="failure"}');
    expect(text).toContain('pehle_tts_fallback_chime_total{reason="other"} 1');
    expect(text).not.toContain("Sharma");
  });
});
