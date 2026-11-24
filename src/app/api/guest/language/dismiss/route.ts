import { handle, json, publicRoute } from "@/lib/http";
import { dismissLanguageHint, guestFromCookie } from "@/domain/rsvp/service";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  publicRoute("guest family cookie (HMAC-signed link key), own family only");
  const g = await guestFromCookie();
  await dismissLanguageHint(g.family.id);
  return json({ ok: true });
});
