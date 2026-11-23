import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { resolveCaller } from "@/lib/assistant/caller";
import { confirmAction } from "@/lib/assistant/service";

const Body = z.object({ mode: z.enum(["staff", "guest"]), actionId: z.string().uuid(), token: z.string().min(20).max(100) });

/** Execute a proposed action: single-use token, 5-minute expiry, permission re-checked, audited. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const caller = await resolveCaller(body.mode);
  return json(await confirmAction(caller, body.actionId, body.token));
});
