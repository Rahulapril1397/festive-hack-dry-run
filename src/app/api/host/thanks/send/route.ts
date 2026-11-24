import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { SendInput, sendNotes } from "@/domain/thanks/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const s = await requireSelected("thanks.manage");
  const { ids } = await parseBody(req, SendInput);
  return json({ sent: await sendNotes(s, ids) });
});
