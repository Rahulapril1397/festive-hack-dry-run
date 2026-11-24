/**
 * Pure helpers for the admin guest lookup (no I/O; unit-tested). The lookup never returns phone
 * numbers, link keys or check-in codes: only what an organiser needs to answer "who is coming".
 */
export type GuestQuery = { token: number } | { name: string } | null;

/** "12" (up to 6 digits) means a token number; anything else with letters is a name search. */
export function parseGuestQuery(q: string | undefined): GuestQuery {
  const t = (q ?? "").trim();
  if (!t) return null;
  if (/^\d{1,6}$/.test(t)) return { token: Number(t) };
  return { name: t.slice(0, 60) };
}

/** Escape % and _ so a name search is a plain substring match. */
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export type FamilyRow = { id: string; name: string; token_number: number | null; language: string };
export type RsvpRow = { family_id: string; event_id: string; status: "pending" | "yes" | "no"; headcount: number };
export type QueueRow = { family_id: string; event_id: string; status: string };

export type GuestDetail = {
  family: string;
  token: number | null;
  language: string;
  rsvp: { function: string; status: "attending" | "not attending" | "no answer yet"; guests: number }[];
  checkedInTo: string[];
};

const STATUS = { yes: "attending", no: "not attending", pending: "no answer yet" } as const;

export function shapeGuests(families: FamilyRow[], rsvps: RsvpRow[], queue: QueueRow[], events: { id: string; name: string }[]): GuestDetail[] {
  return families.map((f) => ({
    family: f.name,
    token: f.token_number,
    language: f.language,
    rsvp: events.map((e) => {
      const r = rsvps.find((x) => x.family_id === f.id && x.event_id === e.id);
      return { function: e.name, status: STATUS[r?.status ?? "pending"], guests: r?.status === "yes" ? r.headcount : 0 };
    }),
    checkedInTo: events.filter((e) => queue.some((q) => q.family_id === f.id && q.event_id === e.id)).map((e) => e.name),
  }));
}

/** The function a question is about, by case-insensitive name; null = all functions. */
export function matchFunction<T extends { name: string }>(events: T[], name: string | undefined): T[] | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  return events.filter((e) => e.name.toLowerCase().includes(n));
}
