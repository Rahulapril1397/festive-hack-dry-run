import { z } from "zod";
import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { guestFromCookie, setFamilyLanguage } from "@/domain/rsvp/service";
import { ENABLED_LANGUAGES } from "@/lib/sarvam/languages";

/** Guest. POST { language } → stores family.language. */
export const POST = handle(async (req: Request) => {
  publicRoute("guest family cookie (HMAC-signed link key), own family only");
  const g = await guestFromCookie();
  const { language } = await parseBody(req, z.object({ language: z.enum(ENABLED_LANGUAGES) }));
  await setFamilyLanguage(g.family.id, language);
  return json({ language });
});
