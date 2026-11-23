import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { decide } from "@/domain/photos/service";

type Ctx = { params: Promise<{ id: string }> };

/** photos.review. POST { decision: "confirmed" | "rejected" } — a human decision; never automatic. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const s = await getSession();
  const ctx = await requirePermission(s, "photos.review", s?.weddingId ?? "");
  const { decision } = await parseBody(req, z.object({ decision: z.enum(["confirmed", "rejected"]) }));
  return json(await decide(ctx, id, decision));
});
