import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { DraftPatch, updateDraft } from "@/domain/thanks/service";

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("thanks.manage");
  return json(await updateDraft(s, (await params).id, await parseBody(req, DraftPatch)));
});
