import { describe, expect, it } from "vitest";
import { planDemo, type DemoPhoto } from "@/domain/photos/demoPlan";

const T0 = Date.UTC(2026, 11, 13, 14, 0, 0);
/** 12 photos a minute apart: well separated, so every planned bucket is exact. */
const spaced = (n = 12): DemoPhoto[] => Array.from({ length: n }, (_, i) => ({ name: `p${String(i + 1).padStart(2, "0")}.jpg`, ms: T0 + i * 60_000 }));

describe("photo demo plan", () => {
  it("12 well-spaced photos: 8 Check this (2 with two candidates), 4 Unmatched", () => {
    const plan = planDemo(spaced());
    expect(plan.expected).toEqual({ check: 8, ambiguous: 2, unmatched: 4 });
    expect(plan.families).toBe(10); // 6 singles + 2 x 2 ambiguous
    expect(plan.events).toHaveLength(10);
  });
  it("every planned event lies inside the 3 second window of its photo", () => {
    const photos = spaced();
    const plan = planDemo(photos);
    for (const e of plan.events) {
      const p = photos.find((x) => x.name === e.photo)!;
      expect(Math.abs(e.atMs - p.ms)).toBeLessThanOrEqual(3000);
    }
  });
  it("ambiguous photos get two different families", () => {
    const plan = planDemo(spaced());
    const byPhoto = new Map<string, number[]>();
    for (const e of plan.events) byPhoto.set(e.photo, [...(byPhoto.get(e.photo) ?? []), e.familyIndex]);
    const two = [...byPhoto.values()].filter((v) => v.length === 2);
    expect(two).toHaveLength(2);
    for (const v of two) expect(new Set(v).size).toBe(2);
  });
  it("a burst of photos seconds apart is reported honestly (more candidates than planned)", () => {
    const burst = Array.from({ length: 12 }, (_, i) => ({ name: `b${i}.jpg`, ms: T0 + i * 1500 }));
    const plan = planDemo(burst);
    expect(plan.expected.check).toBeGreaterThan(8); // neighbours fall inside each other's window
  });
  it("is deterministic and does not depend on input order", () => {
    const a = planDemo(spaced());
    const b = planDemo([...spaced()].reverse());
    expect(b.events).toEqual(a.events);
  });
  it("fewer photos than the target mix still works", () => {
    const plan = planDemo(spaced(5));
    expect(plan.expected.check).toBe(5);
    expect(plan.expected.unmatched).toBe(0);
  });
});
