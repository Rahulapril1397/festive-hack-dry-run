import "server-only";
import { getSession, requirePermission, type Session } from "@/lib/authz";
import { guestFromCookie } from "@/domain/rsvp/service";
import { AppError } from "@/lib/errors";
import type { AppLanguage } from "@/lib/sarvam/languages";
import { staffActive } from "./scope";

export type GuestCaller = { kind: "guest"; familyId: string; weddingId: string; language: AppLanguage; linkKey: string; events: { id: string; name: string }[]; weddingName: string };
export type StaffCaller = { kind: "staff"; session: Session; weddingId: string; weddingName: string; language: AppLanguage };
export type Caller = StaffCaller | GuestCaller;

/**
 * Who is talking to PinkyBua. mode "staff": signed-in staff with assistant.use in the selected
 * wedding. mode "guest": the signed family cookie. Never both, never inferred from the prompt.
 */
export async function resolveCaller(mode: "staff" | "guest"): Promise<Caller> {
  if (mode === "staff") {
    const s = await getSession();
    await requirePermission(s, "assistant.use", s?.weddingId ?? "");
    if (!staffActive(s!)) throw new AppError("FORBIDDEN", "PinkyBua is not active for your role yet");
    const w = s!.weddings.find((x) => x.id === s!.weddingId);
    return { kind: "staff", session: s!, weddingId: s!.weddingId, weddingName: w?.name ?? "", language: "en" };
  }
  const g = await guestFromCookie().catch(() => {
    throw new AppError("UNAUTHENTICATED", "Open your family link again");
  });
  return {
    kind: "guest",
    familyId: g.family.id,
    weddingId: g.wedding.id,
    language: g.family.language,
    linkKey: g.family.linkKey,
    events: g.events.map((e) => ({ id: e.id, name: e.name })),
    weddingName: g.wedding.coupleNames ?? g.wedding.name,
  };
}

export const callerRole = (c: Caller) => (c.kind === "guest" ? "guest" : c.session.role || "coordinator");

/** Stable id of who is asking (rate limits, logs): the staff user or the family. */
export const callerKey = (c: Caller) => (c.kind === "guest" ? `family:${c.familyId}` : `user:${c.session.userId}`);
