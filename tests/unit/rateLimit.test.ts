import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "@/lib/rateLimit";

describe("rate limit", () => {
  beforeEach(resetRateLimit);
  it("allows up to max in the window, then refuses, then recovers", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000, 1000 + i)).toBe(true);
    expect(rateLimit("k", 3, 60_000, 1100)).toBe(false);
    expect(rateLimit("k", 3, 60_000, 1000 + 60_001)).toBe(true);
  });
  it("callers are counted separately", () => {
    for (let i = 0; i < 2; i++) rateLimit("a", 2, 60_000, 1);
    expect(rateLimit("a", 2, 60_000, 2)).toBe(false);
    expect(rateLimit("b", 2, 60_000, 2)).toBe(true);
  });
});

import { z } from "zod";
import { MAX_JSON_BODY_BYTES, parseBody } from "@/lib/http";

describe("parseBody size cap", () => {
  const schema = z.object({ a: z.string() });
  const req = (body: string, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });
  it("parses normal JSON, refuses bad JSON and oversized bodies", async () => {
    expect(await parseBody(req('{"a":"b"}'), schema)).toEqual({ a: "b" });
    await expect(parseBody(req("nope"), schema)).rejects.toThrow(/JSON/);
    await expect(parseBody(req('{"a":"b"}', { "content-length": String(MAX_JSON_BODY_BYTES + 1) }), schema)).rejects.toThrow(/too large/);
    await expect(parseBody(req(JSON.stringify({ a: "x".repeat(MAX_JSON_BODY_BYTES + 10) })), schema)).rejects.toThrow(/JSON|large/);
  });
});
