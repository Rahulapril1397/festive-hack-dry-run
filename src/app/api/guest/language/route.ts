import { z } from "zod";
import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { allowedLanguages, guestFromCookie, setFamilyLanguage } from "@/domain/rsvp/service";
import { ENABLED_LANGUAGES } from "@/lib/sarvam/languages";

/** Guest. POST { language, source? } → stores family.language (+ where the choice came from). */
export const POST = handle(async (req: Request) => {
  publicRoute("guest family cookie (HMAC-signed link key), own family only");
  const g = await guestFromCookie();
  const { language, source } = await parseBody(req, z.object({ language: z.enum(ENABLED_LANGUAGES), source: z.enum(["manual", "browser", "location"]).default("manual") }));
  if (!(await allowedLanguages(g.family)).includes(language)) throw new AppError("BAD_REQUEST", "That language is not available for this link");
  await setFamilyLanguage(g.family.id, language, source);
  return json({ language });
});
