import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { DocumentInput } from "@/contracts/vendors";
import { addDocument } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

/** vendors.manage: record an uploaded document (path must be under this wedding + vendor). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("vendors.manage");
  return json(await addDocument(s, (await params).id, await parseBody(req, DocumentInput)), 201);
});
