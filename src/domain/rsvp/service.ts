import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { isAppLanguage, languagesFor, type AppLanguage, type LanguageGroup } from "@/lib/sarvam/languages";
import { languageSplitPct } from "@/lib/flags/split";
import { groupFor } from "./group";
import { GUEST_COOKIE, verifyGuestCookie } from "./guestCookie";
import type { RsvpInputT, ProfileInputT } from "./schema";

export type GuestFamily = { id: string; name: string; language: AppLanguage; weddingId: string; linkKey: string; token: number | null; languageSource: string; languageGroup: LanguageGroup | null };
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
    .select("id, name, language, wedding_id, link_key, token_number, language_source, language_group")
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
    languageSource: f.language_source ?? "default",
    languageGroup: f.language_group === "A" || f.language_group === "B" ? f.language_group : null,
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

export type LanguageSource = "manual" | "browser" | "location" | "host";

export async function setFamilyLanguage(familyId: string, language: AppLanguage, source: LanguageSource = "manual") {
  const { error } = await db().from("family").update({ language, language_source: source }).eq("id", familyId);
  if (error) throw new Error(error.message);
}

/** The family's A/B group, assigning and saving it on first use (hash of the family id vs the Flagsmith split). */
export async function ensureLanguageGroup(f: Pick<GuestFamily, "id" | "languageGroup">): Promise<LanguageGroup> {
  if (f.languageGroup) return f.languageGroup;
  const group = groupFor(f.id, await languageSplitPct());
  await db().from("family").update({ language_group: group }).eq("id", f.id).is("language_group", null);
  return group;
}

/** Languages this family may pick (group A: English and Hindi; group B: all ten), always including their current one. */
export async function allowedLanguages(f: Pick<GuestFamily, "id" | "languageGroup" | "language">): Promise<AppLanguage[]> {
  const list = [...languagesFor(await ensureLanguageGroup(f))];
  return list.includes(f.language) ? list : [...list, f.language];
}

export type GuestProfile = { travelMode: string | null; travelNumber: string | null; arrivalAt: string | null; departureAt: string | null; arrivingCount: number | null; foodPref: string | null; foodNote: string | null };
const IST_MS = 5.5 * 3600_000;

/** The family's trip and food answers; arrival comes back as India local time (YYYY-MM-DDTHH:mm) for the form. */
export async function loadProfile(familyId: string): Promise<GuestProfile> {
  const { data } = await db().from("guest_profile").select("travel_mode, travel_number, arrival_at, departure_at, arriving_count, food_pref, food_note").eq("family_id", familyId).maybeSingle();
  return {
    travelMode: data?.travel_mode ?? null,
    travelNumber: data?.travel_number ?? null,
    arrivalAt: data?.arrival_at ? new Date(new Date(data.arrival_at).getTime() + IST_MS).toISOString().slice(0, 16) : null,
    departureAt: data?.departure_at ? new Date(new Date(data.departure_at).getTime() + IST_MS).toISOString().slice(0, 16) : null,
    arrivingCount: data?.arriving_count ?? null,
    foodPref: data?.food_pref ?? null,
    foodNote: data?.food_note ?? null,
  };
}

export async function saveProfile(familyId: string, p: ProfileInputT): Promise<GuestProfile> {
  const arrival = p.arrivalAt ? new Date(`${p.arrivalAt}:00+05:30`) : null;
  if (arrival && Number.isNaN(arrival.getTime())) throw new AppError("BAD_REQUEST", "That arrival time is not valid");
  const { error } = await db().from("guest_profile").upsert({
    family_id: familyId,
    travel_mode: p.travelMode,
    travel_number: p.travelNumber ? p.travelNumber.toUpperCase() : null,
    arrival_at: arrival ? arrival.toISOString() : null,
    departure_at: p.departureAt ? new Date(`${p.departureAt}:00+05:30`).toISOString() : null,
    arriving_count: p.arrivingCount,
    food_pref: p.foodPref,
    food_note: p.foodNote,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return loadProfile(familyId);
}
