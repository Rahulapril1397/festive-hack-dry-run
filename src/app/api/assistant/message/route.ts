import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { resolveCaller } from "@/lib/assistant/caller";
import { runAssistant } from "@/lib/assistant/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ mode: z.enum(["staff", "guest"]), sessionId: z.string().uuid().optional(), text: z.string().trim().min(1).max(2000), language: z.literal("en").optional() });

/** PinkyBua. Staff: assistant.use. Guest: family cookie. → { sessionId, text, proposedAction? } */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const resolved = await resolveCaller(body.mode);
  // Voice is down → the widget asks for the default English text chat for this reply.
  const caller = body.language === "en" ? { ...resolved, language: "en" as const } : resolved;
  return json(await runAssistant(caller, body), { headers: { "cache-control": "no-store" } });
});
