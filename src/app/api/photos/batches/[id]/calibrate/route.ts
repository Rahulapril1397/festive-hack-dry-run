import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { Calibration, calibrate } from "@/domain/photos/service";

type Ctx = { params: Promise<{ id: string }> };

/** photos.upload. POST { qrText, exifMs } — QR decoded in the browser, signature verified here. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const s = await getSession();
  const ctx = await requirePermission(s, "photos.upload", s?.weddingId ?? "");
  return json(await calibrate(ctx, id, await parseBody(req, Calibration)));
});
