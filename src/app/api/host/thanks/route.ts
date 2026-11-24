import { handle, json } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { getTemplates, listNotes, thankYouResults } from "@/domain/thanks/service";

export const dynamic = "force-dynamic";

/** thanks.manage: templates, notes and A/B results. */
export const GET = handle(async () => {
  const s = await requireSelected("thanks.manage");
  const [templates, notes, results] = await Promise.all([getTemplates(s.weddingId), listNotes(s.weddingId), thankYouResults(s.weddingId)]);
  return json({ templates, notes, results }, { headers: { "cache-control": "no-store" } });
});
