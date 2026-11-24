import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { GenerateInput, generateDrafts } from "@/domain/thanks/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** thanks.manage: drafts for attending families (variant by stable hash; Sarvam translation). */
export const POST = handle(async (req: Request) => {
  const s = await requireSelected("thanks.manage");
  return json(await generateDrafts(s, await parseBody(req, GenerateInput)));
});
