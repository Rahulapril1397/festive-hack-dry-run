import { z } from "zod";
import { cookies } from "next/headers";
import { handle, json, parseBody, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { getSession, WEDDING_COOKIE } from "@/lib/authz";

/** Any signed-in staff member: switch the selected wedding to one they have access to. */
export const POST = handle(async (req: Request) => {
  publicRoute("signed-in user, may only select a wedding they already have access to");
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED");
  const { weddingId } = await parseBody(req, z.object({ weddingId: z.string().uuid() }));
  if (!s.weddings.some((w) => w.id === weddingId)) throw new AppError("FORBIDDEN");
  (await cookies()).set(WEDDING_COOKIE, weddingId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return json({ weddingId });
});
