import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { appLanguageOf, sarvam, SarvamError } from "@/lib/sarvam/client";
import type { AppLanguage } from "@/lib/sarvam/languages";
import { isEnabled } from "@/lib/flags";
import type { Caller } from "./caller";
import { runAssistant } from "./service";

/**
 * PinkyBua voice (Stage 3): caller's recorded question → Sarvam STT → the normal assistant loop
 * (same permissions, same confirm-before-write) → Sarvam TTS of the reply. If TTS fails the text
 * reply still comes back; if STT fails nothing reaches the model.
 */
export const MAX_AUDIO_BYTES = 2_000_000; // ~60 s of 16 kHz mono WAV; the client stops at 30 s
const SPEAKABLE_CHARS = 1200;

/** Plain text for speech: no markdown, no URLs, bounded length (cut at a sentence end). */
export function speakable(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#>`|]/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= SPEAKABLE_CHARS) return plain;
  const cut = plain.slice(0, SPEAKABLE_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("। "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > 200 ? cut.slice(0, end + 1) : cut).trim();
}

const SCRIPTS: { lang: AppLanguage; re: RegExp }[] = [
  { lang: "hi", re: /[\u0900-\u097F]/g },
  { lang: "bn", re: /[\u0980-\u09FF]/g },
  { lang: "pa", re: /[\u0A00-\u0A7F]/g },
  { lang: "gu", re: /[\u0A80-\u0AFF]/g },
  { lang: "ta", re: /[\u0B80-\u0BFF]/g },
  { lang: "te", re: /[\u0C00-\u0C7F]/g },
  { lang: "kn", re: /[\u0C80-\u0CFF]/g },
  { lang: "ml", re: /[\u0D00-\u0D7F]/g },
  { lang: "en", re: /[A-Za-z]/g },
];

/** Speak the reply in the script it was written in (Devanagari is Hindi, or Marathi when that is the asker's language); else the asker's language. */
export function replyLanguage(text: string, fallback: AppLanguage): AppLanguage {
  let best: AppLanguage = fallback;
  let max = 0;
  for (const { lang, re } of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (n > max) {
      max = n;
      best = lang;
    }
  }
  return best === "hi" && fallback === "mr" ? "mr" : best;
}

export type VoiceStatus = { available: boolean; reason: "ok" | "off" | "forced" | "flag" };

/**
 * Is voice AI usable right now? No when Sarvam is not configured, when failure is forced
 * (SARVAM_FORCE_FAIL=1, or the Flagsmith flag sarvam_force_fail for a live demo), or when the
 * voice_calls flag is OFF (e.g. after a NudgeBee recommendation was approved). The widget then
 * drops to the default English text chat; nothing else is affected.
 */
export async function voiceStatus(): Promise<VoiceStatus> {
  if (sarvam().off) return { available: false, reason: "off" };
  if (process.env.SARVAM_FORCE_FAIL === "1" || (await isEnabled("sarvam_force_fail"))) return { available: false, reason: "forced" };
  if (!(await isEnabled("voice_calls"))) return { available: false, reason: "flag" };
  return { available: true, reason: "ok" };
}

export const VOICE_DOWN_MESSAGE = "Voice assistant is unavailable right now — switching to English text chat.";

export async function runVoice(c: Caller, input: { sessionId?: string; audio: Blob; speak: boolean }) {
  if (input.audio.size === 0) throw new AppError("NO_SPEECH", "No audio received");
  if (input.audio.size > MAX_AUDIO_BYTES) throw new AppError("BAD_REQUEST", "Recording too long — keep it under 30 seconds");
  const status = await voiceStatus();
  if (!status.available) throw new AppError("VOICE_UNAVAILABLE", VOICE_DOWN_MESSAGE);
  const client = sarvam({ timeoutMs: 15_000 });

  let heard: { transcript: string; language: string | null };
  try {
    heard = await client.stt(input.audio, { language: "unknown" });
  } catch (e) {
    log("WARNING", "assistant stt failed", { kind: e instanceof SarvamError ? e.kind : "error" });
    throw new AppError("VOICE_UNAVAILABLE", VOICE_DOWN_MESSAGE);
  }
  if (!heard.transcript) throw new AppError("NO_SPEECH", "I didn't catch that — please try again");

  const reply = await runAssistant(c, { sessionId: input.sessionId, text: heard.transcript.slice(0, 2000) });
  const spokenLang = replyLanguage(reply.text, appLanguageOf(heard.language) ?? c.language);

  let audio: string | null = null;
  let degraded = false;
  if (input.speak && reply.text) {
    try {
      const a = await sarvam({ timeoutMs: 12_000 }).tts(speakable(reply.text), spokenLang);
      audio = Buffer.from(a.bytes).toString("base64");
    } catch (e) {
      degraded = true; // the written answer still goes out; the widget switches to English text chat
      log("WARNING", "assistant tts failed", { kind: e instanceof SarvamError ? e.kind : "error" });
    }
  }
  return { ...reply, transcript: heard.transcript, language: spokenLang, audio, audioType: audio ? "audio/wav" : null, degraded };
}
