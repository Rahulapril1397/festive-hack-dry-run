import { z } from "zod";
import { eventForTvKey } from "@/domain/queue/service";
import { recordChime } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const Body = z.object({
  event: z.literal("chime"),
  eventId: z.string().uuid(),
  key: z.string().min(1).max(200),
  announcementId: z.string().uuid().optional().nullable(),
  reason: z.string().max(40).optional(),
});

/** E2. POST { event: "chime", eventId, key, announcementId?, reason? } → 204; increments pehle_tts_fallback_chime_total. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  if (!(await eventForTvKey(parsed.data.eventId, parsed.data.key))) return new Response(null, { status: 403 });
  recordChime(parsed.data.reason ?? "other"); // reason collapses to a fixed enum
  return new Response(null, { status: 204 });
}
