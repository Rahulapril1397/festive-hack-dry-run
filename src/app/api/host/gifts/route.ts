import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { GiftInput, hostGifts, upsertGift } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = await requireSelected("gifts.manage");
  return json({ gifts: await hostGifts(s.weddingId) }, { headers: { "cache-control": "no-store" } });
});

export const POST = handle(async (req: Request) => {
  const s = await requireSelected("gifts.manage");
  return json(await upsertGift(s, null, await parseBody(req, GiftInput)), 201);
});
