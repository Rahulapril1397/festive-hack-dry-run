import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { resolveCaller } from "@/lib/assistant/caller";
import { cancelAction } from "@/lib/assistant/service";

const Body = z.object({ mode: z.enum(["staff", "guest"]), actionId: z.string().uuid() });

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const caller = await resolveCaller(body.mode);
  return json(await cancelAction(caller, body.actionId));
});
