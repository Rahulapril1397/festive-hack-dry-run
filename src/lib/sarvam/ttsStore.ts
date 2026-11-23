import "server-only";
import { db } from "@/lib/db/service";
import { sha256 } from "@/lib/assistant/hash";
import type { AudioStore } from "./announce";

/** Supabase Storage bucket "tts" (private). Key: <lang>/<sha256(text)>.wav — no text, no family data. */
export const TTS_BUCKET = "tts";
export const ttsPath = (lang: string, text: string) => `${lang}/${sha256(text)}.wav`;

export const ttsStore: AudioStore = {
  async get(lang, text) {
    const { data, error } = await db().storage.from(TTS_BUCKET).download(ttsPath(lang, text));
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: "audio/wav" };
  },
  async put(lang, text, audio) {
    await db().storage.from(TTS_BUCKET).upload(ttsPath(lang, text), audio.bytes, { contentType: audio.contentType, upsert: true });
  },
};
