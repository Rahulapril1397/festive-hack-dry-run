import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession, requirePermission } from "@/lib/authz";
import { rpc } from "@/lib/db/service";
import { RsvpInput } from "@/domain/rsvp/schema";

type Ctx = { params: Promise<{ id: string }> };

/** rsvp.manage. Edit RSVPs on behalf of a family (same rules as the guest form; audited). */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await getSession();
  const ctx = await requirePermission(s, "rsvp.manage", s?.weddingId ?? "");
  const input = await parseBody(req, RsvpInput);
  const rows = await rpc<{ event_id: string; status: string; headcount: number }[]>("rsvp_save_by_staff", { p_actor: ctx.userId, p_wedding: ctx.weddingId, p_family: id, p_rsvps: input.rsvps });
  return json({ rsvps: rows.map((r) => ({ eventId: r.event_id, status: r.status, headcount: r.headcount })) });
});
