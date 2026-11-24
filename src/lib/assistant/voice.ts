import "server-only";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { appLanguageOf, sarvam, SarvamError } from "@/lib/sarvam/client";
import type { AppLanguage } from "@/lib/sarvam/languages";
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

/** Speak the reply in the script it was written in (Devanagari → Hindi), else the asker's language. */
export function replyLanguage(text: string, fallback: AppLanguage): AppLanguage {
  const deva = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (deva === 0 && latin === 0) return fallback;
  return deva >= latin ? "hi" : "en";
}

export async function runVoice(c: Caller, input: { sessionId?: string; audio: Blob; speak: boolean }) {
  if (input.audio.size === 0) throw new AppError("NO_SPEECH", "No audio received");
  if (input.audio.size > MAX_AUDIO_BYTES) throw new AppError("BAD_REQUEST", "Recording too long — keep it under 30 seconds");
  const client = sarvam({ timeoutMs: 15_000 });
  if (client.off) throw new AppError("VOICE_UNAVAILABLE", "Voice is off (Sarvam not configured)");

  let heard: { transcript: string; language: string | null };
  try {
    heard = await client.stt(input.audio, { language: "unknown" });
  } catch (e) {
    log("WARNING", "assistant stt failed", { kind: e instanceof SarvamError ? e.kind : "error" });
    throw new AppError("VOICE_UNAVAILABLE", "Couldn't hear that right now — please type your question");
  }
  if (!heard.transcript) throw new AppError("NO_SPEECH", "I didn't catch that — please try again");

  const reply = await runAssistant(c, { sessionId: input.sessionId, text: heard.transcript.slice(0, 2000) });
  const spokenLang = replyLanguage(reply.text, appLanguageOf(heard.language) ?? c.language);

  let audio: string | null = null;
  if (input.speak && reply.text) {
    try {
      const a = await sarvam({ timeoutMs: 12_000 }).tts(speakable(reply.text), spokenLang);
      audio = Buffer.from(a.bytes).toString("base64");
    } catch (e) {
      log("WARNING", "assistant tts failed", { kind: e instanceof SarvamError ? e.kind : "error" });
    }
  }
  return { ...reply, transcript: heard.transcript, language: spokenLang, audio, audioType: audio ? "audio/wav" : null };
}
