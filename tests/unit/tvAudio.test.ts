import { describe, expect, it } from "vitest";
import { fetchAnnouncement } from "@/domain/queue/tvAudio";

const res = (status: number, type: string | null, body: BodyInit | null = null) =>
  new Response(body, { status, headers: type ? { "content-type": type } : {} });

const fake = (r: () => Promise<Response>) => ((() => r()) as unknown) as typeof fetch;

describe("TV announcement fallback (TTS failure path)", () => {
  it("204 from the stubbed audio route → chime", async () => {
    const out = await fetchAnnouncement("a1", fake(async () => res(204, null)));
    expect(out).toEqual({ kind: "chime", reason: "http" });
  });

  it("non-audio content → chime", async () => {
    const out = await fetchAnnouncement("a1", fake(async () => res(200, "application/json", "{}")));
    expect(out).toEqual({ kind: "chime", reason: "not_audio" });
  });

  it("5xx → chime", async () => {
    const out = await fetchAnnouncement("a1", fake(async () => res(502, "text/plain", "bad")));
    expect(out.kind).toBe("chime");
  });

  it("network error → chime", async () => {
    const out = await fetchAnnouncement("a1", fake(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(out).toEqual({ kind: "chime", reason: "error" });
  });

  it("slower than the timeout → chime (timeout)", async () => {
    const slow: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const t0 = Date.now();
    const out = await fetchAnnouncement("a1", slow, 60);
    expect(out).toEqual({ kind: "chime", reason: "timeout" });
    expect(Date.now() - t0 < 1000).toBe(true);
  });

  it("audio within the timeout → play it", async () => {
    const out = await fetchAnnouncement("a1", fake(async () => res(200, "audio/mpeg", new Uint8Array([1, 2, 3]))));
    expect(out.kind).toBe("audio");
  });
});
