import { handle, json, publicRoute } from "@/lib/http";
import { guestFromCookie } from "@/domain/rsvp/service";
import { releaseClaim } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  publicRoute("guest family cookie (HMAC-signed link key), own claims only");
  const g = await guestFromCookie();
  await releaseClaim(g.family.id, (await params).id);
  return json({ ok: true });
});
