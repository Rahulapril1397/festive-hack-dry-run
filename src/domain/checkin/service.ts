import "server-only";
import { z } from "zod";
import { rpc } from "@/lib/db/service";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { CheckinResult, QueueEntryStatus } from "@/contracts/queue";
import { isCheckinCode, normalizePhone } from "./phone";

export const VerifyInput = z.object({
  phone: z.string().min(6).max(20),
  code: z.string().min(1).max(10),
  eventId: z.string().uuid(),
});

export const WalkInInput = z.object({
  eventId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().max(20).optional().nullable(),
  language: z.enum(["en", "hi"]).default("en"),
});

export const DeskInput = z.object({ eventId: z.string().uuid(), familyId: z.string().uuid() });

type JoinRow = {
  familyId: string;
  linkKey: string;
  entryId: string;
  token: number;
  status: QueueEntryStatus;
  position: number | null;
};

export const familyLink = (linkKey: string) => `${env().APP_URL}/f/${linkKey}`;

function toResult(r: JoinRow): CheckinResult {
  return { token: r.token, position: r.position, status: r.status, familyLink: familyLink(r.linkKey) };
}

/** Guest self check-in. Unknown phone and wrong code produce the same error. */
export async function verifyAndJoin(input: z.infer<typeof VerifyInput>): Promise<CheckinResult> {
  const phone = normalizePhone(input.phone);
  if (!phone || !isCheckinCode(input.code)) throw new AppError("CHECKIN_INVALID", "Phone number or code not recognised");
  const r = await rpc<{ outcome: "ok" | "invalid" | "locked" } & Partial<JoinRow>>("checkin_verify", {
    p_phone: phone,
    p_code: input.code,
    p_event: input.eventId,
  });
  if (r.outcome === "locked") throw new AppError("CHECKIN_LOCKED", "Too many attempts — please ask the check-in desk");
  if (r.outcome !== "ok") throw new AppError("CHECKIN_INVALID", "Phone number or code not recognised");
  return toResult(r as unknown as JoinRow);
}

export async function walkIn(input: z.infer<typeof WalkInInput>, actorId: string): Promise<CheckinResult> {
  let phone: string | null = null;
  if (input.phone && input.phone.trim()) {
    phone = normalizePhone(input.phone);
    if (!phone) throw new AppError("BAD_REQUEST", "Phone number is not a valid mobile number");
  }
  const r = await rpc<JoinRow>("checkin_walk_in", {
    p_event: input.eventId,
    p_actor: actorId,
    p_name: input.name,
    p_phone: phone,
    p_language: input.language,
  });
  return toResult(r);
}

/** Desk check-in of an existing family (no code needed; staff has verified them). */
export async function deskJoin(input: z.infer<typeof DeskInput>, actorId: string): Promise<CheckinResult> {
  const r = await rpc<JoinRow>("checkin_join", {
    p_family: input.familyId,
    p_event: input.eventId,
    p_actor: actorId,
    p_method: "desk",
  });
  return toResult(r);
}

export type LookupRow = {
  family_id: string;
  name: string;
  phone_last4: string | null;
  token: number | null;
  is_walk_in: boolean;
  checked_in: boolean;
  queue_status: QueueEntryStatus | null;
};

export async function lookup(eventId: string, q: string): Promise<LookupRow[]> {
  return rpc<LookupRow[]>("checkin_lookup", { p_event: eventId, p_q: q });
}
