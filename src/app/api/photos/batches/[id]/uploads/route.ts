import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { UploadRequest, signedUploads } from "@/domain/photos/service";

type Ctx = { params: Promise<{ id: string }> };

/** photos.upload. POST { files: [{ name, hash? }] } → { uploads (signed URLs), existing (hashes already in the batch) }. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const s = await getSession();
  const ctx = await requirePermission(s, "photos.upload", s?.weddingId ?? "");
  const { files } = await parseBody(req, UploadRequest);
  return json(await signedUploads(ctx, id, files));
});
