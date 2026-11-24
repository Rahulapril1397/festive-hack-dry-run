import { describe, expect, it, vi } from "vitest";
import { detectLanguage } from "@/lib/assistant/language";
import { assistantSpeaker } from "@/lib/assistant/voice";
import { createSarvamClient } from "@/lib/sarvam/client";
import { buildSystemPrompt } from "@/lib/assistant/context";

describe("PinkyBua replies in the language the person uses", () => {
  it("detects the language of typed or transcribed text by script", () => {
    expect(detectLanguage("मेरे फ़ोटो कितने बचे हैं?")).toBe("hi");
    expect(detectLanguage("ரிசெப்ஷனில் எத்தனை புகைப்படங்கள்?")).toBe("ta");
    expect(detectLanguage("రిసెప్షన్‌లో ఎన్ని ఫోటోలు?")).toBe("te");
    expect(detectLanguage("কতগুলি ছবি বাকি?")).toBe("bn");
    expect(detectLanguage("How many photos are waiting?")).toBe("en");
    expect(detectLanguage("आपण कोणत्या कार्यांना होकार दिला?", "mr")).toBe("mr");
    expect(detectLanguage("आपण कोणत्या कार्यांना होकार दिला?")).toBe("hi");
    expect(detectLanguage("12 ??")).toBeNull();
  });
  it("mixed text goes by the dominant script", () => {
    expect(detectLanguage("Reception में कितने photos बचे हैं और कब तक review होंगे")).toBe("hi");
    expect(detectLanguage("What does रिसेप्शन mean in the app today?")).toBe("en");
  });
  it("the system prompt names this turn's language and tells the model to follow the person", () => {
    const c = { kind: "staff", session: {} as never, weddingId: "w", weddingName: "W", language: "ta" } as const;
    const p = buildSystemPrompt(c, "admin", "", "2026-12-13");
    expect(p).toContain("Tamil");
    expect(p).toMatch(/language the user is writing or speaking in/);
    expect(buildSystemPrompt({ ...c, language: "en" }, "admin", "", "2026-12-13")).toContain("English");
  });
});

describe("PinkyBua's voice is female", () => {
  it("defaults to priya; SARVAM_ASSISTANT_SPEAKER overrides; the TV speaker setting is separate", () => {
    vi.stubEnv("SARVAM_ASSISTANT_SPEAKER", "");
    expect(assistantSpeaker()).toBe("priya");
    vi.stubEnv("SARVAM_ASSISTANT_SPEAKER", "ritu");
    expect(assistantSpeaker()).toBe("ritu");
    vi.unstubAllEnvs();
  });
  it("text-to-speech uses the per-call speaker, else the client's (TV) speaker", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)).speaker);
      return new Response(JSON.stringify({ audios: [Buffer.from("x").toString("base64")] }), { status: 200 });
    });
    const c = createSarvamClient({ apiKey: "k", speaker: "shubh", fetchImpl: fetchImpl as unknown as typeof fetch });
    await c.tts("hi", "hi", { speaker: "priya" });
    await c.tts("hi", "hi");
    expect(seen).toEqual(["priya", "shubh"]);
  });
});
