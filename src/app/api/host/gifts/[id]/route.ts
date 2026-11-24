import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { GiftPatch, upsertGift } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("gifts.manage");
  return json(await upsertGift(s, (await params).id, await parseBody(req, GiftPatch)));
});
