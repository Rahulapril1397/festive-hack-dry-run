import { describe, expect, it, vi } from "vitest";
import { createSarvamClient, appLanguageOf } from "@/lib/sarvam/client";
import { replyLanguage, speakable } from "@/lib/assistant/voice";

describe("Sarvam speech-to-text", () => {
  it("posts multipart with file, model, transcribe mode and auto language; parses transcript", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const f = init.body as FormData;
      expect(f.get("model")).toBe("saaras:v3");
      expect(f.get("mode")).toBe("transcribe");
      expect(f.get("language_code")).toBe("unknown");
      expect(f.get("file")).toBeInstanceOf(Blob);
      expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined(); // boundary set by fetch
      return new Response(JSON.stringify({ transcript: " कितने परिवार आए? ", language_code: "hi-IN" }), { status: 200 });
    });
    const c = createSarvamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await c.stt(new Blob([new Uint8Array(10)], { type: "audio/wav" }));
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.sarvam.ai/speech-to-text");
    expect(r).toEqual({ transcript: "कितने परिवार आए?", language: "hi-IN" });
  });
  it("is off (throws) without a key outside tests; HTTP errors surface as SarvamError", async () => {
    await expect(createSarvamClient({ apiKey: "", allowMock: false }).stt(new Blob([]))).rejects.toThrow(/not configured/);
    const bad = createSarvamClient({ apiKey: "k", fetchImpl: (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch });
    await expect(bad.stt(new Blob([new Uint8Array(4)]))).rejects.toThrow(/HTTP 400/);
  });
  it("maps Sarvam language codes to enabled app languages", () => {
    expect(appLanguageOf("hi-IN")).toBe("hi");
    expect(appLanguageOf("en-IN")).toBe("en");
    expect(appLanguageOf("ta-IN")).toBeNull();
    expect(appLanguageOf(null)).toBeNull();
  });
});

describe("spoken replies", () => {
  it("strips markdown and links, keeps it short at a sentence end", () => {
    expect(speakable("**3 families** are waiting. See https://x.y/z")).toBe("3 families are waiting. See");
    const long = "Token 12 is next. ".repeat(120);
    const out = speakable(long);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.endsWith(".")).toBe(true);
  });
  it("speaks in the script the reply was written in", () => {
    expect(replyLanguage("अभी टोकन 12 स्टेज पर है।", "en")).toBe("hi");
    expect(replyLanguage("Token 12 is on stage.", "hi")).toBe("en");
    expect(replyLanguage("12", "hi")).toBe("hi");
  });
});
