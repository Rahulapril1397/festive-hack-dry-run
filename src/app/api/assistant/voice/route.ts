import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimit";
import { resolveCaller, callerKey } from "@/lib/assistant/caller";
import { MAX_AUDIO_BYTES, runVoice, voiceStatus } from "@/lib/assistant/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Mode = z.enum(["staff", "guest"]);
const modeOf = (req: Request) => Mode.parse(new URL(req.url).searchParams.get("mode") ?? "staff");

/** Is voice usable? { available, reason }. Same caller check as the chat (admin login / family cookie). */
export const GET = handle(async (req: Request) => {
  await resolveCaller(modeOf(req));
  return json(await voiceStatus(), { headers: { "cache-control": "no-store" } });
});

/**
 * PinkyBua voice. POST ?mode=staff|guest, multipart: sessionId?, speak (0|1), audio (WAV, ≤30 s).
 * The caller is checked BEFORE the upload is read, a content length is required, and each caller is
 * limited to 12 voice questions a minute (each one is three Sarvam calls).
 * → { sessionId, transcript, text, proposedAction?, audio?, audioType?, degraded }
 */
export const POST = handle(async (req: Request) => {
  const caller = await resolveCaller(modeOf(req));
  if (!rateLimit(`voice:${callerKey(caller)}`, 12, 60_000)) throw new AppError("RATE_LIMITED", "Too many questions — please wait a moment");
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length <= 0 || length > MAX_AUDIO_BYTES + 10_000) throw new AppError("BAD_REQUEST", "Recording missing or too long — keep it under 30 seconds");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("BAD_REQUEST", "Expected multipart form data");
  }
  const f = z.object({ sessionId: z.string().uuid().optional(), speak: z.enum(["0", "1"]).default("1") }).parse({ sessionId: form.get("sessionId") || undefined, speak: form.get("speak") ?? undefined });
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new AppError("BAD_REQUEST", "audio file missing");
  return json(await runVoice(caller, { sessionId: f.sessionId, audio, speak: f.speak === "1" }), { headers: { "cache-control": "no-store" } });
});
