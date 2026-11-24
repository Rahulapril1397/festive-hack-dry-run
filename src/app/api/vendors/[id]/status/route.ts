import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { setVendorStatus } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected("vendors.manage");
  const { status } = await parseBody(req, z.object({ status: z.enum(["active", "inactive"]) }));
  return json(await setVendorStatus(s, (await params).id, status));
});
