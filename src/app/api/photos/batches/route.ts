import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { NewBatch, batchesFor, createBatch } from "@/domain/photos/service";

/** photos.upload. POST { eventId, cameraName } → batch. GET ?eventId → batches. */
export const POST = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "photos.upload", s?.weddingId ?? "");
  return json(await createBatch(ctx, await parseBody(req, NewBatch)), 201);
});

export const GET = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "photos.upload", s?.weddingId ?? "");
  return json({ batches: await batchesFor(ctx, new URL(req.url).searchParams.get("eventId") ?? "") });
});
