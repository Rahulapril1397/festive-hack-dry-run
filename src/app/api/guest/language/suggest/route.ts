import { z } from "zod";
import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { guestFromCookie } from "@/domain/rsvp/service";
import { languageAt } from "@/lib/geo/stateBounds";
import { LANGUAGES } from "@/lib/sarvam/languages";

export const dynamic = "force-dynamic";

/**
 * Guest tapped "Use my location". Coarse coordinates in, a language suggestion out. Coordinates
 * are rounded again here and neither stored nor logged (the request log has no body).
 */
export const POST = handle(async (req: Request) => {
  publicRoute("guest family cookie (HMAC-signed link key); stateless lookup, nothing stored");
  await guestFromCookie();
  const { lat, lon } = await parseBody(req, z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }));
  const r = languageAt(Math.round(lat * 10) / 10, Math.round(lon * 10) / 10);
  return json({ state: r.state, language: r.enabled ? r.language : null, languageLabel: r.language ? LANGUAGES[r.language].native : null, available: r.enabled });
});
