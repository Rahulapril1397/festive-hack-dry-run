import { handle, json } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { findDuplicates } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

/** vendors.manage: similar names / same phone in this wedding, for the "possible duplicate" warning. */
export const GET = handle(async (req: Request) => {
  const s = await requireSelected("vendors.manage");
  const p = new URL(req.url).searchParams;
  const exclude = p.get("exclude");
  return json({ matches: await findDuplicates(s, (p.get("name") ?? "").slice(0, 120), (p.get("phone") ?? "").slice(0, 20), exclude && /^[0-9a-f-]{36}$/i.test(exclude) ? exclude : undefined) });
});
