import { handle, json, parseBody } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { NoteInput } from "@/contracts/vendors";
import { addNote } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

/** vendors.manage; a restricted note (commercial readers only) needs vendors.commercial.write. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireSelected(["vendors.manage", "vendors.commercial.write"]);
  await addNote(s, (await params).id, await parseBody(req, NoteInput));
  return json({ ok: true }, 201);
});
