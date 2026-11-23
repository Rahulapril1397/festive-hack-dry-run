import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, escalationLevel, istDay, reminderSchedule, retryAt, slotKey } from "@/lib/jobs/schedule";
import { TRANSITIONS, canTransition, isOverdue, whatsappText } from "@/domain/tasks/status";

const T0 = new Date("2026-12-13T10:07:30Z");

describe("job retries", () => {
  it("backs off 1 min, 5 min, 30 min, then dead", () => {
    expect(retryAt(1, T0)!.getTime() - T0.getTime()).toBe(60_000);
    expect(retryAt(2, T0)!.getTime() - T0.getTime()).toBe(300_000);
    expect(retryAt(3, T0)!.getTime() - T0.getTime()).toBe(1_800_000);
    expect(retryAt(4, T0)).toBeNull();
    expect(MAX_ATTEMPTS).toBe(4);
  });
  it("recurring slots dedupe within 15 minutes", () => {
    expect(slotKey("scan", T0, 15)).toBe("scan:2026-12-13T10:00Z");
    expect(slotKey("scan", new Date("2026-12-13T10:14:59Z"), 15)).toBe("scan:2026-12-13T10:00Z");
    expect(slotKey("scan", new Date("2026-12-13T10:15:00Z"), 15)).toBe("scan:2026-12-13T10:15Z");
  });
  it("nightly jobs use the Indian calendar day", () => {
    expect(istDay(new Date("2026-12-13T18:29:00Z"))).toBe("2026-12-13");
    expect(istDay(new Date("2026-12-13T18:31:00Z"))).toBe("2026-12-14");
  });
});

describe("task reminders and escalation", () => {
  it("schedules only future reminders", () => {
    const due = new Date("2026-12-14T12:00:00Z");
    expect(reminderSchedule(due, T0).map((r) => r.kind)).toEqual(["24h", "1h"]);
    expect(reminderSchedule(due, new Date("2026-12-13T12:00:00Z")).map((r) => r.kind)).toEqual(["1h"]);
    expect(reminderSchedule(due, new Date("2026-12-14T11:30:00Z"))).toEqual([]);
  });
  it("level 1 after the escalation window, level 2 six hours later", () => {
    const due = new Date("2026-12-13T08:00:00Z");
    expect(escalationLevel(due, new Date("2026-12-13T09:59:00Z"), 2)).toBe(0);
    expect(escalationLevel(due, new Date("2026-12-13T10:00:00Z"), 2)).toBe(1);
    expect(escalationLevel(due, new Date("2026-12-13T16:00:00Z"), 2)).toBe(2);
  });
});

describe("task status machine", () => {
  it("terminal states have no exits; reopen only from in progress", () => {
    expect(TRANSITIONS.done).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
    expect(canTransition("in_progress", "open")).toBe(true);
    expect(canTransition("open", "done")).toBe(false);
    expect(canTransition("blocked", "done")).toBe(true);
  });
  it("overdue = past due and not finished", () => {
    expect(isOverdue({ status: "open", dueAt: "2020-01-01T00:00:00Z" })).toBe(true);
    expect(isOverdue({ status: "done", dueAt: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isOverdue({ status: "open", dueAt: null })).toBe(false);
  });
  it("WhatsApp text carries title, owner, status and link", () => {
    const t = whatsappText({ title: "Book dhol", dueAt: "2026-12-13T08:00:00Z", ownerName: "Mama ji", eventName: "Sangeet", status: "in_progress" }, "http://x/tasks?task=1");
    expect(t).toContain("*Book dhol*");
    expect(t).toContain("Owner: Mama ji");
    expect(t).toContain("Status: In progress");
    expect(t).toContain("Function: Sangeet");
    expect(t).toContain("http://x/tasks?task=1");
  });
});
