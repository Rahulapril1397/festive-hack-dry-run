import { afterEach, describe, expect, it, vi } from "vitest";
import { createSarvamClient } from "@/lib/sarvam/client";
import { createFlagClient } from "@/lib/flags/client";
import { isEnabled } from "@/lib/flags";
import { applyOverrides } from "@/lib/flags/overrides";

afterEach(() => vi.unstubAllEnvs());

describe("no mock integrations in staging/production (E2 T7)", () => {
  it("Sarvam without a key in production: translate stays English, tts throws (TV chimes)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    const s = createSarvamClient({ apiKey: "" });
    expect(s.mock).toBe(false);
    expect(await s.translate("Hello", "hi")).toBe("Hello");
    await expect(s.tts("x", "en")).rejects.toThrow(/not configured/);
  });

  it("Flagsmith without a key in production: safe fallbacks, no granted overrides", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = createFlagClient({ serverKey: "" });
    expect(c.mock).toBe(false);
    expect(await isEnabled("voice_calls", c)).toBe(true); // fallback keeps announcing; TV chimes if TTS is off
    expect(await applyOverrides({ userId: "u", role: "stage_manager", weddingId: "w" }, "queue.skip", false, { client: c, roles: ["stage_manager"] })).toBe(false);
  });

  it("local development keeps the mocks", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ENV", "local");
    expect(createSarvamClient({ apiKey: "" }).mock).toBe(true);
    expect(createFlagClient({ serverKey: "" }).mock).toBe(true);
  });
});
