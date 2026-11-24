import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/flags", () => ({ isEnabled: vi.fn(async (f: string) => (f === "voice_calls" ? flags.voice_calls : flags.sarvam_force_fail)) }));
const flags = { voice_calls: true, sarvam_force_fail: false };

import { voiceStatus } from "@/lib/assistant/voice";

describe("voiceStatus: when PinkyBua drops to English text chat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    flags.voice_calls = true;
    flags.sarvam_force_fail = false;
  });
  it("available when Sarvam is configured and nothing forces failure", async () => {
    vi.stubEnv("SARVAM_API_KEY", "k");
    expect(await voiceStatus()).toEqual({ available: true, reason: "ok" });
  });
  it("unavailable without a Sarvam key (never mocked outside tests)", async () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await voiceStatus()).toEqual({ available: false, reason: "off" });
  });
  it("forced failure by env or by the Flagsmith demo flag", async () => {
    vi.stubEnv("SARVAM_API_KEY", "k");
    vi.stubEnv("SARVAM_FORCE_FAIL", "1");
    expect(await voiceStatus()).toEqual({ available: false, reason: "forced" });
    vi.stubEnv("SARVAM_FORCE_FAIL", "0");
    flags.sarvam_force_fail = true;
    expect(await voiceStatus()).toEqual({ available: false, reason: "forced" });
  });
  it("voice_calls OFF (e.g. after the NudgeBee approval) also turns voice AI off", async () => {
    vi.stubEnv("SARVAM_API_KEY", "k");
    flags.voice_calls = false;
    expect(await voiceStatus()).toEqual({ available: false, reason: "flag" });
  });
});
