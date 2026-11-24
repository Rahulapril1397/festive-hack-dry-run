import "server-only";
import type { Caller } from "../caller";

/**
 * Stage 3 PinkyBua tools. Each calls a domain service in the caller's wedding; the tool list was
 * already filtered by permission and is re-checked at execution. No phones, no amounts.
 */
const staffOnly = (c: Caller) => {
  if (c.kind !== "staff") throw new Error("staff only");
  return c;
};

export async function tasksOverview(c: Caller) {
  const s = staffOnly(c);
  const { taskSummary, listTasks } = await import("@/domain/tasks/service");
  const [summary, mine] = await Promise.all([taskSummary(s.weddingId), listTasks(s.session, { mine: "1" })]);
  return {
    ...summary,
    myOpenTasks: mine
      .filter((t) => t.status !== "done" && t.status !== "cancelled")
      .slice(0, 10)
      .map((t) => ({ title: t.title, status: t.status, dueAt: t.dueAt, overdue: t.overdue, function: t.event?.name ?? null })),
  };
}

export async function giftSummary(c: Caller) {
  const s = staffOnly(c);
  return (await import("@/domain/gifts/service")).giftClaimSummary(s.weddingId);
}

export async function thanksStats(c: Caller) {
  const s = staffOnly(c);
  return (await import("@/domain/thanks/service")).thankYouStats(s.weddingId);
}

export async function vendorLookup(c: Caller, query?: string) {
  const s = staffOnly(c);
  const { listVendors } = await import("@/domain/vendors/service");
  const vendors = await listVendors(s.session, { q: query, status: "active" });
  return {
    count: vendors.length,
    vendors: vendors.slice(0, 15).map((v) => ({ name: v.name, category: v.categoryName, status: v.status, functions: v.events.map((e) => e.name) })),
  };
}

export async function myGifts(c: Caller) {
  if (c.kind !== "guest") throw new Error("guest only");
  return (await import("@/domain/gifts/service")).listGiftsForFamily(c.familyId, c.weddingId);
}
