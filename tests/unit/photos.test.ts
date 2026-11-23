import { describe, expect, it } from "vitest";
import { matchPhoto, countBuckets, type StageLogLite } from "@/domain/photos/match";
import { clockOffsetMs, correctedMs, exifToEpochMs } from "@/domain/photos/time";

const T = Date.UTC(2026, 11, 13, 14, 0, 0); // 19:30 IST
const log = (id: string, deltaMs: number, action = "called", entry = id): StageLogLite => ({ id, action, createdMs: T + deltaMs, queueEntryId: entry, token: Number(id.replace(/\D/g, "")) || 1 });

describe("matching window edges", () => {
  it("exactly 3000 ms matches, 3001 ms does not (both directions)", () => {
    expect(matchPhoto(T, [log("a1", 3000)])).toHaveLength(1);
    expect(matchPhoto(T, [log("a1", -3000)])).toHaveLength(1);
    expect(matchPhoto(T, [log("a1", 3001)])).toHaveLength(0);
    expect(matchPhoto(T, [log("a1", -3001)])).toHaveLength(0);
  });

  it("two overlapping candidates are both returned, ranked by |delta|", () => {
    const c = matchPhoto(T, [log("a1", 2500, "called", "q1"), log("a2", -800, "called", "q2")]);
    expect(c.map((x) => x.stageLogId)).toEqual(["a2", "a1"]);
    expect(c[0]!.deltaMs).toBe(-800);
  });

  it("prefers on_stage over called for the same family, even if called is closer", () => {
    const c = matchPhoto(T, [log("c1", 100, "called", "q1"), log("s1", 2000, "on_stage", "q1")]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ stageLogId: "s1", action: "on_stage" });
  });

  it("falls back to called when on_stage is outside the window", () => {
    const c = matchPhoto(T, [log("c1", 100, "called", "q1"), log("s1", 9000, "on_stage", "q1")]);
    expect(c[0]).toMatchObject({ stageLogId: "c1", action: "called" });
  });

  it("ignores pause/skip/served logs and honours a per-wedding window", () => {
    expect(matchPhoto(T, [log("p1", 0, "paused"), log("k1", 0, "skipped")])).toHaveLength(0);
    expect(matchPhoto(T, [log("a1", 4000)], 5000)).toHaveLength(1);
  });

  it("buckets", () => {
    expect(countBuckets(["matched", "check", "check", "unmatched"])).toEqual({ matched: 1, check: 2, unmatched: 1 });
  });
});

describe("clock offset maths", () => {
  it("parses EXIF with offset and sub-seconds", () => {
    expect(exifToEpochMs("2026:12:13 19:30:00", "25", "+05:30")).toBe(T + 250);
    expect(exifToEpochMs("2026:12:13 14:00:00", null, "+00:00")).toBe(T);
  });
  it("defaults to IST when OffsetTimeOriginal is missing; rejects garbage", () => {
    expect(exifToEpochMs("2026:12:13 19:30:00")).toBe(T);
    expect(exifToEpochMs("yesterday")).toBeNull();
    expect(exifToEpochMs(undefined)).toBeNull();
  });
  it("camera behind the server clock → positive offset; ahead → negative", () => {
    const behind = clockOffsetMs(T, T - 42_000);
    expect(behind).toBe(42_000);
    expect(correctedMs(T - 42_000 + 5000, behind)).toBe(T + 5000);
    const ahead = clockOffsetMs(T, T + 1_500);
    expect(ahead).toBe(-1500);
    expect(correctedMs(T + 1_500, ahead)).toBe(T);
  });
  it("a corrected photo then matches the stage call it was taken at", () => {
    const offset = clockOffsetMs(T, T - 60_000); // camera 60 s slow
    const photoExif = T - 60_000 + 10_000; // taken 10 s after T by real time
    expect(matchPhoto(correctedMs(photoExif, offset), [log("a1", 10_500)])).toHaveLength(1);
    expect(matchPhoto(photoExif, [log("a1", 10_500)])).toHaveLength(0); // uncorrected misses
  });
});
