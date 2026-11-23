import "server-only";
import { db, listEvents } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { getQueueStatus } from "@/domain/queue";
import { setFamilyLanguage } from "@/domain/rsvp/service";
import { countBuckets, type Bucket } from "@/domain/photos/match";
import type { Caller } from "../caller";
import { callerRole } from "../caller";
import { knowledgeFor, sectionsAbout } from "../kb";

type QueueMod = typeof import("@/domain/queue/service");
type LedgerMod = typeof import("@/domain/ledger/service");
type LedgerModel = typeof import("@/domain/ledger/model");

async function eventsOf(c: Caller) {
  return c.kind === "guest" ? c.events : (await listEvents(c.weddingId)).map((e) => ({ id: e.id, name: e.name }));
}

export async function queueStatus(c: Caller, eventId: string | undefined, q: QueueMod) {
  const events = (await eventsOf(c)).filter((e) => !eventId || e.id === eventId);
  if (eventId && !events.length) throw new AppError("EVENT_NOT_FOUND");
  return Promise.all(
    events.map(async (e) => {
      const s = await q.getQueueSnapshot(e.id);
      const active = s.entries.find((x) => x.entryId === s.currentEntryId);
      const waiting = s.entries.filter((x) => x.status === "waiting");
      return {
        function: e.name,
        paused: s.paused,
        nowOnStage: active?.token ?? null,
        nextToken: waiting[0]?.token ?? null,
        waiting: waiting.length,
        served: s.counts?.served ?? 0,
        noShow: s.counts?.no_show ?? 0,
      };
    }),
  );
}

export async function rsvpSummary(c: Caller) {
  const { data: plates } = await db().from("v_event_plates").select("event_id, name, planned_plates, attending_families, arrived_families").eq("wedding_id", c.weddingId);
  const ids = (plates ?? []).map((p) => p.event_id);
  const { data: rs } = ids.length ? await db().from("rsvp").select("event_id, status").in("event_id", ids) : { data: [] };
  return (plates ?? []).map((p) => {
    const mine = (rs ?? []).filter((r) => r.event_id === p.event_id);
    return {
      function: p.name,
      attendingFamilies: p.attending_families,
      notAttending: mine.filter((r) => r.status === "no").length,
      pending: mine.filter((r) => r.status === "pending").length,
      plannedPlates: p.planned_plates,
      arrivedFamilies: p.arrived_families,
    };
  });
}

export async function findFamilyToken(c: Caller, token: number) {
  const { data: f } = await db().from("family").select("id, name, token_number").eq("wedding_id", c.weddingId).eq("token_number", token).maybeSingle();
  if (!f) return { found: false };
  const events = await eventsOf(c);
  const { data: qe } = await db().from("queue_entry").select("event_id, status").eq("family_id", f.id);
  return {
    found: true,
    family: f.name,
    token: f.token_number,
    perFunction: events.map((e) => ({ function: e.name, status: (qe ?? []).find((x) => x.event_id === e.id)?.status ?? "not checked in" })),
  };
}

export async function photoCounts(c: Caller) {
  const events = await eventsOf(c);
  return Promise.all(
    events.map(async (e) => {
      const { data } = await db().from("photo").select("review_status, batch:batch_id!inner(event_id)").eq("batch.event_id", e.id);
      return { function: e.name, ...countBuckets((data ?? []).map((p) => p.review_status as Bucket)) };
    }),
  );
}

export async function ledgerSummary(c: Caller, l: LedgerMod, m: LedgerModel) {
  return m.summarize(await l.listEntries(c.weddingId));
}

export async function explain(c: Caller, topic: string) {
  return sectionsAbout(knowledgeFor(callerRole(c)), topic);
}

export async function myRsvp(c: Caller) {
  if (c.kind !== "guest") throw new AppError("FORBIDDEN");
  const { data } = await db().from("rsvp").select("event_id, status, headcount").eq("family_id", c.familyId);
  return c.events.map((e) => {
    const r = (data ?? []).find((x) => x.event_id === e.id);
    return { function: e.name, answer: r?.status === "yes" ? "attending" : r?.status === "no" ? "not attending" : "not answered yet", guests: r?.headcount ?? 0 };
  });
}

export async function myQueue(c: Caller) {
  if (c.kind !== "guest") throw new AppError("FORBIDDEN");
  return Promise.all(
    c.events.map(async (e) => {
      const s = await getQueueStatus(c.familyId, e.id);
      return { function: e.name, checkedIn: s.checkedIn, token: s.token, status: s.status, placeInQueue: s.position, nowOnStage: s.nowServing, paused: s.paused };
    }),
  );
}

export async function setMyLanguage(c: Caller, language: "en" | "hi") {
  if (c.kind === "guest") await setFamilyLanguage(c.familyId, language);
  else {
    const { error } = await db().from("app_user").update({ language }).eq("id", c.session.userId);
    if (error) throw new Error(error.message);
  }
  return { language };
}
