import { handle, json } from "@/lib/http";
import { getSession } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { roleHas } from "@/lib/authz/staticMap";
import { env } from "@/lib/env";
import { clockPayload } from "@/lib/clock";

export const dynamic = "force-dynamic";

/** Contract C4. GET → { t_ms, sig, qr } where qr = "PA|<t_ms>|<sig>". Staff with clock.read. */
export const GET = handle(async () => {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  if (!roleHas(s.role, "clock.read")) throw new AppError("FORBIDDEN");
  return json(clockPayload(Date.now(), env().CLOCK_HMAC_SECRET), { headers: { "cache-control": "no-store" } });
});
