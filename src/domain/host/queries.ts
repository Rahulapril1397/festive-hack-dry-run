import "server-only";
import { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { hasPermission, type Session } from "@/lib/authz";
import { normalizePhone } from "@/domain/checkin/phone";
import { AppError } from "@/lib/errors";
import { familyLink } from "@/domain/checkin/service";

export type FunctionRow = {
  eventId: string;
  name: string;
  startsAt: string | null;
  invited: number;
  yes: number;
  no: number;
  pending: number;
  plannedPlates: number;
  checkedIn: number;
  waiting: number;
  paused: boolean;
  nowServing: number | null;
  mealStatus: string;
};

/** Host command centre. Ledger: count only unless the user has ledger.read. */
export async function overview(s: Session) {
  const w = s.weddingId;
  const { data: events } = await db().from("event").select("id, name, starts_at").eq("wedding_id", w).order("starts_at");
  const ids = (events ?? []).map((e) => e.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const inIds = ids.length ? ids : none;

  const [plates, rsvps, queue, states, feeds, calls, ledger, exceptions] = await Promise.all([
    db().from("v_event_plates").select("event_id, planned_plates, arrived_families, meal_status").eq("wedding_id", w),
    db().from("rsvp").select("event_id, status").in("event_id", inIds),
    db().from("queue_entry").select("event_id, status, skip_count, token_number, family:family_id(name)").in("event_id", inIds),
    db().from("queue_state").select("event_id, paused").in("event_id", inIds),
    db().from("tv_feed").select("event_id, token").in("event_id", inIds),
    db().from("stage_log").select("id, event_id, action, token_number, created_at").in("event_id", inIds).order("created_at", { ascending: false }).limit(12),
    db().from("v_ledger_entry").select("amount, payment_method, is_reversal, is_reversed, effective_family_id").eq("wedding_id", w),
    db().from("checkin_attempt").select("family_id, created_at, family:family_id(name)").in("event_id", inIds).eq("success", false).gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString()),
  ]);

  const byEvent = <T extends { event_id: string }>(rows: T[] | null, id: string) => (rows ?? []).filter((r) => r.event_id === id);
  const functions: FunctionRow[] = (events ?? []).map((e) => {
    const r = byEvent(rsvps.data, e.id);
    const p = (plates.data ?? []).find((x) => x.event_id === e.id);
    return {
      eventId: e.id,
      name: e.name,
      startsAt: e.starts_at,
      invited: r.length,
      yes: r.filter((x) => x.status === "yes").length,
      no: r.filter((x) => x.status === "no").length,
      pending: r.filter((x) => x.status === "pending").length,
      plannedPlates: p?.planned_plates ?? 0,
      checkedIn: p?.arrived_families ?? 0,
      waiting: byEvent(queue.data, e.id).filter((q) => q.status === "waiting").length,
      paused: byEvent(states.data, e.id)[0]?.paused ?? false,
      nowServing: byEvent(feeds.data, e.id)[0]?.token ?? null,
      mealStatus: p?.meal_status ?? "not_started",
    };
  });

  const canAmounts = await hasPermission(s, "ledger.read");
  const live = (ledger.data ?? []).filter((l) => !l.is_reversal && !l.is_reversed);
  const evName = new Map((events ?? []).map((e) => [e.id, e.name]));

  // exceptions: lockouts, no-shows, repeated skips, unmatched envelopes
  const lockCounts = new Map<string, { name: string; n: number }>();
  for (const a of exceptions.data ?? []) {
    const name = (a.family as unknown as { name: string } | null)?.name ?? "Family";
    lockCounts.set(a.family_id, { name, n: (lockCounts.get(a.family_id)?.n ?? 0) + 1 });
  }
  const exceptionList: string[] = [
    ...[...lockCounts.values()].filter((x) => x.n >= 5).map((x) => `${x.name}: check-in locked (5 wrong codes) — send to the desk`),
    ...(queue.data ?? []).filter((q) => q.status === "no_show").map((q) => `Token ${q.token_number} (${evName.get(q.event_id)}): no-show`),
    ...(queue.data ?? []).filter((q) => q.status === "waiting" && q.skip_count > 0).map((q) => `Token ${q.token_number} (${evName.get(q.event_id)}): skipped once, back in queue`),
    ...functions.filter((f) => f.paused).map((f) => `${f.name}: queue paused`),
  ];
  if (canAmounts) {
    const unmatched = live.filter((l) => !l.effective_family_id).length;
    if (unmatched) exceptionList.push(`${unmatched} shagun envelope(s) not matched to a family`);
  }

  return {
    kpis: {
      rsvpYes: functions.reduce((a, f) => a + f.yes, 0),
      expectedPlates: functions.reduce((a, f) => a + f.plannedPlates, 0),
      checkedIn: functions.reduce((a, f) => a + f.checkedIn, 0),
      queueWaiting: functions.reduce((a, f) => a + f.waiting, 0),
      ledgerEntries: live.length,
    },
    functions,
    recentCalls: (calls.data ?? []).map((c) => ({ id: c.id, event: evName.get(c.event_id) ?? "", action: c.action, token: c.token_number, at: c.created_at })),
    exceptions: exceptionList,
  };
}

export const AddFamily = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(20).optional().nullable(),
  language: z.enum(["en", "hi"]).default("en"),
});

export async function addFamily(s: Session, input: z.infer<typeof AddFamily>) {
  let phone: string | null = null;
  if (input.phone) {
    phone = normalizePhone(input.phone);
    if (!phone) throw new AppError("BAD_REQUEST", "Phone number is not a valid mobile number");
  }
  return rpc<{ familyId: string; code: string; linkKey: string }>("host_add_family", { p_wedding: s.weddingId, p_actor: s.userId, p_name: input.name, p_phone: phone, p_language: input.language });
}

export const CreateEvent = z.object({
  name: z.string().trim().min(2).max(60),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  language: z.enum(["en", "hi"]).default("en"),
});

export async function createEvent(s: Session, input: z.infer<typeof CreateEvent>) {
  return rpc<{ id: string }>("host_create_event", { p_wedding: s.weddingId, p_actor: s.userId, p_name: input.name, p_starts_at: input.startsAt ?? null, p_language: input.language });
}

/** Families and RSVP table (families.read). Phone as last 4 digits; link only with families.write. */
export async function familiesWithRsvp(s: Session, withLinks = false) {
  const [{ data: fams }, { data: events }, { data: checkins }] = await Promise.all([
    db().from("family").select("id, name, phone, language, token_number, is_walk_in, link_key, headcount_max, rsvp(event_id, status, headcount)").eq("wedding_id", s.weddingId).order("name"),
    db().from("event").select("id, name").eq("wedding_id", s.weddingId).order("starts_at"),
    db().from("checkin").select("family_id, event_id, event:event_id!inner(wedding_id)").eq("event.wedding_id", s.weddingId),
  ]);
  const checkedIn = new Map<string, string[]>();
  for (const c of checkins ?? []) checkedIn.set(c.family_id, [...(checkedIn.get(c.family_id) ?? []), c.event_id]);
  return {
    events: (events ?? []) as { id: string; name: string }[],
    families: (fams ?? []).map((f) => ({
      id: f.id as string,
      name: f.name as string,
      phoneLast4: f.phone ? String(f.phone).slice(-4) : null,
      language: f.language as string,
      token: f.token_number as number | null,
      isWalkIn: f.is_walk_in as boolean,
      headcountMax: f.headcount_max as number | null,
      link: withLinks ? familyLink(f.link_key as string) : null,
      checkedIn: checkedIn.get(f.id as string) ?? [],
      rsvp: Object.fromEntries(((f.rsvp ?? []) as { event_id: string; status: string; headcount: number }[]).map((r) => [r.event_id, { status: r.status, headcount: r.headcount }])) as Record<string, { status: string; headcount: number }>,
    })),
  };
}
export type FamilyRow = Awaited<ReturnType<typeof familiesWithRsvp>>["families"][number];
