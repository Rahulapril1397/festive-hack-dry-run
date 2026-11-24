import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { resolveCaller } from "@/lib/assistant/caller";
import { MAX_AUDIO_BYTES, runVoice } from "@/lib/assistant/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Fields = z.object({ mode: z.enum(["staff", "guest"]), sessionId: z.string().uuid().optional(), speak: z.enum(["0", "1"]).default("1") });

/**
 * PinkyBua voice. multipart: mode, sessionId?, speak (0|1), audio (WAV, ≤30 s).
 * Staff: assistant.use. Guest: family cookie. → { sessionId, transcript, text, proposedAction?, audio?, audioType? }
 */
export const POST = handle(async (req: Request) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 10_000) throw new AppError("BAD_REQUEST", "Recording too long — keep it under 30 seconds");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("BAD_REQUEST", "Expected multipart form data");
  }
  const f = Fields.parse({ mode: form.get("mode"), sessionId: form.get("sessionId") || undefined, speak: form.get("speak") ?? undefined });
  const caller = await resolveCaller(f.mode);
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new AppError("BAD_REQUEST", "audio file missing");
  return json(await runVoice(caller, { sessionId: f.sessionId, audio, speak: f.speak === "1" }), { headers: { "cache-control": "no-store" } });
});
