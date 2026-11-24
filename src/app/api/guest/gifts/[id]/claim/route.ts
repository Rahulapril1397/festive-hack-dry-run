import { z } from "zod";
import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { guestFromCookie } from "@/domain/rsvp/service";
import { claimGift } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

/** Guest: "We'll bring this". Atomic in Postgres; 409 GIFT_UNAVAILABLE when it is fully claimed. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  publicRoute("guest family cookie (HMAC-signed link key), claims for own family only");
  const g = await guestFromCookie();
  const { quantity } = await parseBody(req, z.object({ quantity: z.number().int().min(1).max(10).default(1) }));
  const c = await claimGift(g.family.id, (await params).id, quantity);
  return json({ id: c.id, quantity: c.quantity, status: c.status }, 201);
});
