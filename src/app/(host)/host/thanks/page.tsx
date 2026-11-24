import { requirePage } from "@/components/shell/guard";
import { getTemplates, listNotes, thankYouResults } from "@/domain/thanks/service";
import { ThanksConsole } from "./ThanksConsole";

export const dynamic = "force-dynamic";

/** Thank-you notes (Stage 3 E2 T2–T3): A/B templates, drafts per family, send, results. */
export default async function ThanksPage() {
  const s = await requirePage("thanks.manage", "/host/thanks");
  const [templates, notes, results] = await Promise.all([getTemplates(s.weddingId), listNotes(s.weddingId), thankYouResults(s.weddingId)]);
  return <ThanksConsole initial={{ templates, notes, results }} />;
}
