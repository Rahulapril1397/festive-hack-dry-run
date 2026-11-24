import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimit";
import { callerKey, resolveCaller } from "@/lib/assistant/caller";
import { runAssistant } from "@/lib/assistant/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ mode: z.enum(["staff", "guest"]), sessionId: z.string().uuid().optional(), text: z.string().trim().min(1).max(2000), language: z.literal("en").optional() });

/** PinkyBua. Staff: assistant.use. Guest: family cookie. → { sessionId, text, proposedAction? } */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const caller = await resolveCaller(body.mode);
  if (!rateLimit(`message:${callerKey(caller)}`, 30, 60_000)) throw new AppError("RATE_LIMITED", "Too many questions — please wait a moment");
  // Voice is down → the widget asks for the default English text chat; otherwise the reply follows the language typed.
  return json(await runAssistant(caller, { sessionId: body.sessionId, text: body.text, replyLanguage: body.language }), { headers: { "cache-control": "no-store" } });
});
