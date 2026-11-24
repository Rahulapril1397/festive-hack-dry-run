import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { giftImageUpload } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

/** gifts.manage: signed upload URL for the gift's picture (private bucket). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("gifts.manage");
  const { contentType } = await parseBody(req, z.object({ contentType: z.string() }));
  return json(await giftImageUpload(s, (await params).id, contentType));
});
