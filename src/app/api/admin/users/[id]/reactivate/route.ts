import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/domain/admin/guard";
import { setUserStatus } from "@/domain/admin/service";

type Ctx = { params: Promise<{ id: string }> };

/** users.manage. Takes effect on the user's very next request (status is checked in Postgres). */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const s = await requireAdmin("users.manage");
  return json({ user: await setUserStatus(s, id, "active") });
});
