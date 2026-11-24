import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { UploadInput } from "@/contracts/vendors";
import { documentUploadUrl } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

/** vendors.manage: signed upload URL into the private vendor-docs bucket (PDF / images, ≤20 MB). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("vendors.manage");
  return json(await documentUploadUrl(s, (await params).id, await parseBody(req, UploadInput)));
});
