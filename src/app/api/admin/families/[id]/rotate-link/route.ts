import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/domain/admin/guard";
import { rotateLink } from "@/domain/admin/service";

type Ctx = { params: Promise<{ id: string }> };

/** families.write. New link key; the old link stops working immediately ("resend link"). */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await requireAdmin("families.write");
  return json(await rotateLink(s, s.weddingId, id));
});
