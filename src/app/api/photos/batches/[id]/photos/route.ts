import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { PhotoMeta, recordPhotos } from "@/domain/photos/service";

type Ctx = { params: Promise<{ id: string }> };

/** photos.upload. POST { photos: [{ path, capturedAtMs }] } after the browser uploaded the files. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const s = await getSession();
  const ctx = await requirePermission(s, "photos.upload", s?.weddingId ?? "");
  const { photos } = await parseBody(req, PhotoMeta);
  return json(await recordPhotos(ctx, id, photos), 201);
});
