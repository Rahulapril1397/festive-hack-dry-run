import type { QueueEntryStatus } from "@/contracts/queue";

/**
 * Pure mirror of the transition rules enforced in SQL (supabase/migrations/0002_queue.sql,
 * functions call_next and queue_action). SQL is authoritative; this drives button state
 * in the console and is unit-tested so the two stay in step.
 */
export type EntryAction = "call" | "skip" | "on_stage" | "served" | "no_show";

export const MAX_SKIPS = 2;

const ALLOWED_FROM: Record<EntryAction, readonly QueueEntryStatus[]> = {
  call: ["waiting"],
  skip: ["waiting", "called"],
  on_stage: ["called"],
  served: ["called", "on_stage"],
  no_show: ["waiting", "called"],
};

export type EntryState = { status: QueueEntryStatus; skipCount: number };
export type TransitionResult = EntryState & { requeued: boolean };

export class InvalidTransition extends Error {
  constructor(from: QueueEntryStatus, action: EntryAction) {
    super(`INVALID_TRANSITION: ${action} from ${from}`);
  }
}

export function canApply(state: EntryState, action: EntryAction): boolean {
  return ALLOWED_FROM[action].includes(state.status);
}

export function transition(state: EntryState, action: EntryAction): TransitionResult {
  if (!canApply(state, action)) throw new InvalidTransition(state.status, action);
  switch (action) {
    case "call":
      return { status: "called", skipCount: state.skipCount, requeued: false };
    case "skip": {
      const skipCount = state.skipCount + 1;
      return skipCount >= MAX_SKIPS
        ? { status: "no_show", skipCount, requeued: false }
        : { status: "waiting", skipCount, requeued: true };
    }
    case "on_stage":
      return { status: "on_stage", skipCount: state.skipCount, requeued: false };
    case "served":
      return { status: "served", skipCount: state.skipCount, requeued: false };
    case "no_show":
      return { status: "no_show", skipCount: state.skipCount, requeued: false };
  }
}

/** Queue-level pause state. */
export function canCallNext(q: { paused: boolean; waiting: number }): "ok" | "QUEUE_PAUSED" | "QUEUE_EMPTY" {
  if (q.paused) return "QUEUE_PAUSED";
  if (q.waiting === 0) return "QUEUE_EMPTY";
  return "ok";
}
