import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlagClient } from "@/lib/flags/client";
import { isEnabled } from "@/lib/flags";
import { allowlistedRoles, applyOverrides } from "@/lib/flags/overrides";
import { setFeatureEnabled } from "@/lib/flags/admin";

const flagsBody = (enabled: Record<string, boolean>) =>
  Object.entries(enabled).map(([name, e]) => ({ feature: { name }, enabled: e, feature_state_value: null }));

const okFetch = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

/** A server that never answers, until the AbortSignal fires. */
const hangingFetch = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
) as unknown as typeof fetch;

afterEach(() => vi.restoreAllMocks());

describe("isEnabled", () => {
  it("mock mode (no key) uses local defaults and never calls out", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const c = createFlagClient({ serverKey: "", fetchImpl: f });
    expect(await isEnabled("voice_calls", c)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("reads ON and OFF, with the X-Environment-Key header", async () => {
    const f = okFetch(flagsBody({ voice_calls: false }));
    const c = createFlagClient({ serverKey: "ser.test", fetchImpl: f });
    expect(await isEnabled("voice_calls", c)).toBe(false);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://edge.api.flagsmith.com/api/v1/flags/");
    expect((init as RequestInit).headers).toMatchObject({ "X-Environment-Key": "ser.test" });
  });

  it("caches for 30 s", async () => {
    let t = 0;
    const f = okFetch(flagsBody({ voice_calls: true }));
    const c = createFlagClient({ serverKey: "k", fetchImpl: f, now: () => t });
    await isEnabled("voice_calls", c);
    t = 29_999;
    await isEnabled("voice_calls", c);
    expect(f).toHaveBeenCalledTimes(1);
    t = 30_000;
    await isEnabled("voice_calls", c);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("outage (hanging server) → safe default after the timeout, logs flag_fallback=true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = createFlagClient({ serverKey: "k", fetchImpl: hangingFetch, timeoutMs: 50 });
    expect(await isEnabled("voice_calls", c)).toBe(true);
    expect(warn.mock.calls[0]![0]).toContain("flag_fallback=true");
  });

  it("invalid key (401) and invalid payload → safe default", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unauthorized = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect(await isEnabled("voice_calls", createFlagClient({ serverKey: "bad", fetchImpl: unauthorized }))).toBe(true);
    expect(await isEnabled("voice_calls", createFlagClient({ serverKey: "k", fetchImpl: okFetch({ nope: 1 }) }))).toBe(true);
  });
});

describe("applyOverrides", () => {
  const ctx = { userId: "u", role: "stage", weddingId: "w" };

  it("never revokes a baseline grant", async () => {
    expect(await applyOverrides(ctx, "queue.manage", true, { roles: [] })).toBe(true);
  });

  it("allowlisted role + flag ON grants queue.skip; flag OFF does not", async () => {
    const on = createFlagClient({ serverKey: "k", fetchImpl: okFetch({ flags: flagsBody({ queue_skip_override: true }) }) });
    const off = createFlagClient({ serverKey: "k", fetchImpl: okFetch({ flags: flagsBody({ queue_skip_override: false }) }) });
    expect(await applyOverrides(ctx, "queue.skip", false, { client: on, roles: ["stage"] })).toBe(true);
    expect(await applyOverrides(ctx, "queue.skip", false, { client: off, roles: ["stage"] })).toBe(false);
  });

  it("non-allowlisted role never calls Flagsmith", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const c = createFlagClient({ serverKey: "k", fetchImpl: f });
    expect(await applyOverrides({ ...ctx, role: "kitchen" }, "queue.skip", false, { client: c, roles: ["stage"] })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("permissions without an override flag are untouched", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const c = createFlagClient({ serverKey: "k", fetchImpl: f });
    expect(await applyOverrides(ctx, "ledger.read", false, { client: c, roles: ["stage"] })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("outage → baseline decision", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = createFlagClient({ serverKey: "k", fetchImpl: hangingFetch, timeoutMs: 30 });
    expect(await applyOverrides(ctx, "queue.skip", false, { client: c, roles: ["stage"] })).toBe(false);
  });

  it("allowlist: stage_manager alias, max two roles", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(allowlistedRoles("stage_manager")).toEqual(["stage"]);
    expect(allowlistedRoles("stage, host, kitchen")).toEqual(["stage", "host"]);
  });
});

describe("Flagsmith admin toggle (read-back)", () => {
  const routes = (enabledAfter: boolean, patchStatus = 200) =>
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("?feature_name=")) return new Response(JSON.stringify({ results: [{ id: 7, enabled: true, identity: null, feature_segment: null }] }));
      if (init?.method === "PATCH") return new Response("{}", { status: patchStatus });
      return new Response(JSON.stringify({ id: 7, enabled: enabledAfter }));
    }) as unknown as typeof fetch;

  it("PATCHes the environment feature state and reports the read-back", async () => {
    const f = routes(false);
    const r = await setFeatureEnabled("voice_calls", false, { adminKey: "a", envKey: "e", fetchImpl: f });
    expect(r).toEqual({ ok: true, enabled: false });
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]![0]).toBe("https://api.flagsmith.com/api/v1/environments/e/featurestates/7/");
    expect((calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: "Api-Key a" });
  });

  it("read-back still ON is reported as such (caller must not show Done)", async () => {
    expect(await setFeatureEnabled("voice_calls", false, { adminKey: "a", envKey: "e", fetchImpl: routes(true) })).toEqual({ ok: true, enabled: true });
  });

  it("rejected PATCH or missing config → not ok", async () => {
    expect((await setFeatureEnabled("voice_calls", false, { adminKey: "a", envKey: "e", fetchImpl: routes(false, 403) })).ok).toBe(false);
    expect(await setFeatureEnabled("voice_calls", false, { adminKey: "", envKey: "" })).toEqual({ ok: false, reason: "not_configured" });
  });
});
