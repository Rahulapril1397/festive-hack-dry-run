import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { fulfilClaim } from "@/domain/gifts/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("gifts.manage");
  const { fulfilled } = await parseBody(req, z.object({ fulfilled: z.boolean() }));
  return json(await fulfilClaim(s, (await params).id, fulfilled));
});
