/**
 * Sarvam AI client (verified against docs.sarvam.ai):
 *   POST {SARVAM_API_URL}/translate       { input, source_language_code, target_language_code } → { translated_text }
 *   POST {SARVAM_API_URL}/text-to-speech  { text, language_code, model, speaker }              → { audios: [base64 WAV] }
 *   header api-subscription-key
 * 3-second timeout on every call. Empty SARVAM_API_KEY: mock in tests/local only; in staging/prod
 * the client is "off" (translate returns English, tts throws → TV chime). SARVAM_FORCE_FAIL=1
 * makes tts throw. Only static UI copy and token announcements are ever sent — no names/phones/amounts.
 */
import { LANGUAGES, type AppLanguage } from "./languages";
import { mockAllowed } from "@/lib/mockPolicy";

export class SarvamError extends Error {
  constructor(
    public readonly kind: "timeout" | "error" | "forced",
    message: string,
  ) {
    super(message);
  }
}

export type SarvamOptions = {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  speaker?: string;
  forceFail?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** default: mockAllowed() */
  allowMock?: boolean;
};

export type TtsAudio = { bytes: Uint8Array; contentType: string };

export function createSarvamClient(opts: SarvamOptions = {}) {
  const apiKey = opts.apiKey ?? "";
  const apiUrl = (opts.apiUrl ?? "https://api.sarvam.ai").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const mock = !apiKey && (opts.allowMock ?? mockAllowed());
  const off = !apiKey && !mock;

  async function post(path: string, body: unknown): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${apiUrl}${path}`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "api-subscription-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new SarvamError("error", `HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof SarvamError) throw e;
      throw new SarvamError(ctrl.signal.aborted ? "timeout" : "error", String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    mock,
    off,
    async translate(text: string, targetLang: AppLanguage): Promise<string> {
      if (targetLang === "en" || !text.trim()) return text;
      if (mock || off) return text; // English stays English (page never blocks)
      const r = (await post("/translate", {
        input: text,
        source_language_code: "en-IN",
        target_language_code: LANGUAGES[targetLang].sarvam,
      })) as { translated_text?: unknown };
      if (typeof r.translated_text !== "string" || !r.translated_text.trim()) throw new SarvamError("error", "empty translation");
      return r.translated_text;
    },
    async tts(text: string, lang: AppLanguage): Promise<TtsAudio> {
      if (opts.forceFail) throw new SarvamError("forced", "SARVAM_FORCE_FAIL=1");
      if (mock) return { bytes: mockTone(), contentType: "audio/wav" };
      if (off) throw new SarvamError("error", "SARVAM_API_KEY not configured");
      const r = (await post("/text-to-speech", {
        text,
        language_code: LANGUAGES[lang].sarvam,
        model: opts.model ?? "bulbul:v3",
        speaker: opts.speaker ?? "shubh",
      })) as { audios?: unknown };
      const b64 = Array.isArray(r.audios) ? r.audios[0] : undefined;
      if (typeof b64 !== "string" || !b64) throw new SarvamError("error", "no audio in response");
      return { bytes: new Uint8Array(Buffer.from(b64, "base64")), contentType: "audio/wav" };
    },
  };
}

export type SarvamClient = ReturnType<typeof createSarvamClient>;

/** Reads env on each call so SARVAM_FORCE_FAIL can be flipped without a restart in tests. */
export function sarvam(): SarvamClient {
  return createSarvamClient({
    apiKey: process.env.SARVAM_API_KEY ?? "",
    apiUrl: process.env.SARVAM_API_URL || undefined,
    model: process.env.SARVAM_TTS_MODEL || undefined,
    speaker: process.env.SARVAM_SPEAKER || undefined,
    forceFail: process.env.SARVAM_FORCE_FAIL === "1",
  });
}

/** 0.6 s two-tone WAV so mock mode still exercises the TV's audio path. */
function mockTone(): Uint8Array {
  const rate = 8000;
  const n = Math.floor(rate * 0.6);
  const buf = Buffer.alloc(44 + n);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) {
    const f = i < n / 2 ? 660 : 880;
    buf[44 + i] = 128 + Math.round(60 * Math.sin((2 * Math.PI * f * i) / rate));
  }
  return new Uint8Array(buf);
}
