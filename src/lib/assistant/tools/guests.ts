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
export const likePattern = (s: string) =>
  `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export type FamilyRow = {
  id: string;
  name: string;
  token_number: number | null;
  language: string;
};
export type RsvpRow = {
  family_id: string;
  event_id: string;
  status: "pending" | "yes" | "no";
  headcount: number;
};
export type QueueRow = { family_id: string; event_id: string; status: string };

export type GuestDetail = {
  family: string;
  token: number | null;
  language: string;
  rsvp: {
    function: string;
    status: "attending" | "not attending" | "no answer yet";
    guests: number;
  }[];
  checkedInTo: string[];
  travel: {
    mode: string | null;
    number: string | null;
    arrival: string | null;
    people: number | null;
  } | null;
  food: { preference: string | null; note: string | null } | null;
};
export type ProfileRow = {
  family_id: string;
  travel_mode: string | null;
  travel_number: string | null;
  arrival_at: string | null;
  arriving_count: number | null;
  food_pref: string | null;
  food_note: string | null;
};

const STATUS = {
  yes: "attending",
  no: "not attending",
  pending: "no answer yet",
} as const;

export function shapeGuests(
  families: FamilyRow[],
  rsvps: RsvpRow[],
  queue: QueueRow[],
  events: { id: string; name: string }[],
  profiles: ProfileRow[] = [],
): GuestDetail[] {
  return families.map((f) => {
    const pr = profiles.find((x) => x.family_id === f.id);
    return {
      family: f.name,
      token: f.token_number,
      language: f.language,
      rsvp: events.map((e) => {
        const r = rsvps.find(
          (x) => x.family_id === f.id && x.event_id === e.id,
        );
        return {
          function: e.name,
          status: STATUS[r?.status ?? "pending"],
          guests: r?.status === "yes" ? r.headcount : 0,
        };
      }),
      checkedInTo: events
        .filter((e) =>
          queue.some((q) => q.family_id === f.id && q.event_id === e.id),
        )
        .map((e) => e.name),
      travel:
        pr && (pr.travel_mode || pr.arrival_at)
          ? {
              mode: pr.travel_mode,
              number: pr.travel_number,
              arrival: pr.arrival_at
                ? new Date(pr.arrival_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : null,
              people: pr.arriving_count,
            }
          : null,
      food:
        pr && (pr.food_pref || pr.food_note)
          ? { preference: pr.food_pref, note: pr.food_note }
          : null,
    };
  });
}

/** The function a question is about, by case-insensitive name; null = all functions. */
export function matchFunction<T extends { name: string }>(
  events: T[],
  name: string | undefined,
): T[] | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  return events.filter((e) => e.name.toLowerCase().includes(n));
}
