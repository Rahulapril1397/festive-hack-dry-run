import { handle, json } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { env } from "@/lib/env";
import { clockPayload } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** Contract C4. GET → { t_ms, sig, qr } where qr = "PA|<t_ms>|<sig>". Staff with clock.read. */
export const GET = handle(async () => {
  const s = await getSession();
  await requirePermission(s, "clock.read", s?.weddingId ?? "");
  return json(clockPayload(Date.now(), env().CLOCK_HMAC_SECRET), { headers: { "cache-control": "no-store" } });
});
