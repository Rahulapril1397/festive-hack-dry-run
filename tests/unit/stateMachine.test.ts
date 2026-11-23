import { describe, expect, it } from "vitest";
import { canApply, canCallNext, transition, type EntryAction } from "@/domain/queue/stateMachine";
import type { QueueEntryStatus } from "@/contracts/queue";

type Row = [from: QueueEntryStatus, skips: number, action: EntryAction, to: QueueEntryStatus | "INVALID", skipsAfter?: number];

// Must match queue_action / call_next in supabase/migrations/0002_queue.sql.
const TABLE: Row[] = [
  ["waiting", 0, "call", "called", 0],
  ["called", 0, "call", "INVALID"],
  ["served", 0, "call", "INVALID"],
  ["waiting", 0, "skip", "waiting", 1],
  ["called", 0, "skip", "waiting", 1],
  ["called", 1, "skip", "no_show", 2],
  ["waiting", 1, "skip", "no_show", 2],
  ["on_stage", 0, "skip", "INVALID"],
  ["served", 0, "skip", "INVALID"],
  ["called", 0, "on_stage", "on_stage", 0],
  ["waiting", 0, "on_stage", "INVALID"],
  ["called", 0, "served", "served", 0],
  ["on_stage", 1, "served", "served", 1],
  ["waiting", 0, "served", "INVALID"],
  ["waiting", 0, "no_show", "no_show", 0],
  ["called", 0, "no_show", "no_show", 0],
  ["served", 0, "no_show", "INVALID"],
  ["no_show", 2, "call", "INVALID"],
  ["no_show", 2, "skip", "INVALID"],
];

describe("queue state machine", () => {
  it.each(TABLE)("%s (skips %i) --%s--> %s", (from, skips, action, to, skipsAfter) => {
    const state = { status: from, skipCount: skips };
    if (to === "INVALID") {
      expect(canApply(state, action)).toBe(false);
      expect(() => transition(state, action)).toThrow(/INVALID_TRANSITION/);
    } else {
      expect(canApply(state, action)).toBe(true);
      const next = transition(state, action);
      expect(next.status).toBe(to);
      expect(next.skipCount).toBe(skipsAfter);
    }
  });

  it("skip back to waiting is a requeue (new position at the back)", () => {
    expect(transition({ status: "called", skipCount: 0 }, "skip").requeued).toBe(true);
    expect(transition({ status: "called", skipCount: 1 }, "skip").requeued).toBe(false);
  });

  it("call next is blocked when paused or empty", () => {
    expect(canCallNext({ paused: true, waiting: 3 })).toBe("QUEUE_PAUSED");
    expect(canCallNext({ paused: false, waiting: 0 })).toBe("QUEUE_EMPTY");
    expect(canCallNext({ paused: false, waiting: 1 })).toBe("ok");
  });
});
