import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession, requirePermission } from "@/lib/authz";
import { approveRecommendation } from "@/lib/nudgebee/service";

type Ctx = { params: Promise<{ id: string }> };

/** ops.approve (admin). Human approval of a NudgeBee recommendation. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await getSession();
  const ctx = await requirePermission(s, "ops.approve", s?.weddingId ?? "");
  return json(await approveRecommendation(id, ctx.userId, ctx.weddingId));
});
