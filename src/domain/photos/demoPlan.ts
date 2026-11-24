import { DEFAULT_WINDOW_MS, matchPhoto, type StageLogLite } from "./match";

/**
 * Demo plan for photo matching: given the demo photos' own capture times, decide where to put
 * stage events so the review screen shows a good mix, without editing any photo time.
 *   first `singles` photos   → one stage event within the window (Check this, one candidate)
 *   next `ambiguous` photos  → two stage events for two families within the window (a person chooses)
 *   the rest                 → no stage event near them (Unmatched)
 * The expected buckets are SIMULATED with the real matcher, so a burst of photos taken seconds
 * apart is reported honestly instead of being assumed.
 */
export type DemoPhoto = { name: string; ms: number };
export type PlannedEvent = { photo: string; familyIndex: number; atMs: number };
export type DemoPlan = {
  events: PlannedEvent[];
  families: number;
  expected: { check: number; unmatched: number; ambiguous: number };
  perPhoto: { name: string; candidates: number }[];
};

const SINGLE_OFFSETS_MS = [900, -1200, 1500, -600, 2000, -1800];
const AMBIGUOUS_OFFSETS_MS = [1000, -1400];

export function planDemo(photos: DemoPhoto[], opts: { singles?: number; ambiguous?: number; windowMs?: number } = {}): DemoPlan {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const singles = opts.singles ?? 6;
  const ambiguous = opts.ambiguous ?? 2;
  const sorted = [...photos].sort((a, b) => a.ms - b.ms || a.name.localeCompare(b.name));
  const events: PlannedEvent[] = [];
  let family = 0;
  sorted.slice(0, singles).forEach((p, i) => events.push({ photo: p.name, familyIndex: family++, atMs: p.ms + SINGLE_OFFSETS_MS[i % SINGLE_OFFSETS_MS.length]! }));
  sorted.slice(singles, singles + ambiguous).forEach((p) => AMBIGUOUS_OFFSETS_MS.forEach((o) => events.push({ photo: p.name, familyIndex: family++, atMs: p.ms + o })));

  const logs: StageLogLite[] = events.map((e, i) => ({ id: `e${i}`, action: "on_stage", createdMs: e.atMs, queueEntryId: `q${e.familyIndex}`, token: e.familyIndex + 1 }));
  const perPhoto = sorted.map((p) => ({ name: p.name, candidates: matchPhoto(p.ms, logs, windowMs).length }));
  return {
    events,
    families: family,
    expected: {
      check: perPhoto.filter((p) => p.candidates > 0).length,
      ambiguous: perPhoto.filter((p) => p.candidates > 1).length,
      unmatched: perPhoto.filter((p) => p.candidates === 0).length,
    },
    perPhoto,
  };
}
