import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { isAppLanguage, type AppLanguage } from "@/lib/sarvam/languages";
import { GUEST_COOKIE, verifyGuestCookie } from "./guestCookie";
import type { RsvpInputT } from "./schema";

export type GuestFamily = { id: string; name: string; language: AppLanguage; weddingId: string; linkKey: string; token: number | null };
export type GuestWedding = {
  id: string;
  name: string;
  isDemo: boolean;
  coupleNames: string | null;
  weddingDate: string | null;
  contactPhone: string | null;
  invitationText: string | null;
};
export type GuestEvent = { id: string; name: string; startsAt: string | null };
export type GuestRsvp = { eventId: string; status: "pending" | "yes" | "no"; headcount: number };

/** Everything the family's own pages need, by link key. Null for unknown keys. Cached per request. */
export const loadGuest = cache(async (linkKey: string) => {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(linkKey)) return null;
  const { data: f } = await db()
    .from("family")
    .select("id, name, language, wedding_id, link_key, token_number")
    .eq("link_key", linkKey)
    .maybeSingle();
  if (!f) return null;
  const [{ data: w }, { data: evs }, { data: rs }] = await Promise.all([
    db().from("wedding").select("id, name, is_demo, couple_names, wedding_date, contact_phone, invitation_text").eq("id", f.wedding_id).single(),
    db().from("event").select("id, name, starts_at").eq("wedding_id", f.wedding_id).order("starts_at", { ascending: true }),
    db().from("rsvp").select("event_id, status, headcount").eq("family_id", f.id),
  ]);
  if (!w) return null;
  const family: GuestFamily = {
    id: f.id,
    name: f.name,
    language: isAppLanguage(f.language) ? f.language : "en",
    weddingId: f.wedding_id,
    linkKey: f.link_key,
    token: f.token_number,
  };
  const wedding: GuestWedding = {
    id: w.id,
    name: w.name,
    isDemo: w.is_demo,
    coupleNames: w.couple_names,
    weddingDate: w.wedding_date,
    contactPhone: w.contact_phone,
    invitationText: w.invitation_text,
  };
  const events: GuestEvent[] = (evs ?? []).map((e) => ({ id: e.id, name: e.name, startsAt: e.starts_at }));
  const rsvps: GuestRsvp[] = (rs ?? []).map((r) => ({ eventId: r.event_id, status: r.status, headcount: r.headcount }));
  return { family, wedding, events, rsvps };
});

/** The family identified by the signed cookie. Throws UNAUTHENTICATED. */
export async function guestFromCookie() {
  const store = await cookies();
  const linkKey = await verifyGuestCookie(store.get(GUEST_COOKIE)?.value, process.env.GUEST_COOKIE_SECRET ?? "");
  const g = linkKey ? await loadGuest(linkKey) : null;
  if (!g) throw new AppError("UNAUTHENTICATED", "Open your family link again");
  return g;
}

export async function saveRsvps(familyId: string, input: RsvpInputT): Promise<GuestRsvp[]> {
  const rows = await rpc<{ event_id: string; status: GuestRsvp["status"]; headcount: number }[]>("rsvp_save", {
    p_family: familyId,
    p_rsvps: input.rsvps,
  });
  return rows.map((r) => ({ eventId: r.event_id, status: r.status, headcount: r.headcount }));
}

export async function setFamilyLanguage(familyId: string, language: AppLanguage) {
  const { error } = await db().from("family").update({ language }).eq("id", familyId);
  if (error) throw new Error(error.message);
}
