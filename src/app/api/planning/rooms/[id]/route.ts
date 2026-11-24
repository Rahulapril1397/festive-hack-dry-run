import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession, requirePermission } from "@/lib/authz";
import { deleteRoom } from "@/domain/planning/service";

/** planning.write. DELETE a room that has no family in it. */
export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  await deleteRoom(ctx.weddingId, id);
  return json({ ok: true });
});
