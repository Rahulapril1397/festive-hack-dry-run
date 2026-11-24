import { handle, json, publicRoute } from "@/lib/http";
import { guestFromCookie } from "@/domain/rsvp/service";
import { guestGifts } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

/** Guest: the wishlist with availability and this family's own claims (no other families). */
export const GET = handle(async () => {
  publicRoute("guest family cookie (HMAC-signed link key), own family only");
  const g = await guestFromCookie();
  return json({ gifts: await guestGifts(g.family.id, g.family.weddingId) }, { headers: { "cache-control": "no-store" } });
});
