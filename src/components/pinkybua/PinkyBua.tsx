"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_SECONDS, micSupport, startRecording, type Recording } from "./recorder";
import type { AppLanguage } from "@/lib/sarvam/languages";

type Proposed = { id: string; token: string; summary: string; expiresAt: string };
type Msg = { from: "me" | "bua" | "system"; text: string; proposed?: Proposed; state?: "pending" | "done" | "cancelled" | "failed"; voice?: boolean; pendingVoice?: boolean; audio?: string };
type Reply = { sessionId: string; text: string; proposedAction?: Proposed; transcript?: string; audio?: string | null; audioType?: string | null; degraded?: boolean };

const LABELS = {
  en: { open: "Ask PinkyBua", title: "PinkyBua", placeholder: "Ask about photos waiting for review…", placeholderGuest: "Ask about your RSVP…", send: "Send", thinking: "Thinking…", error: "PinkyBua is not available right now. Everything else keeps working.", confirm: "Confirm", cancel: "Cancel", done: "Done", cancelled: "Cancelled", hello: "Namaste! How can I help?", mic: "Ask by voice", stop: "Stop and send", recording: "Listening… tap to send", hearing: "Listening to your question…", voiceOff: "Voice needs a secure (https) connection. On this site's plain http address the browser blocks the microphone — type your question instead.", noMic: "This browser can't record audio — please type your question.", micDenied: "Microphone permission was denied. Allow it in the browser to ask by voice.", downBanner: "Voice assistant is unavailable. You are now in the default English text chat.", retryVoice: "Try voice again", voiceBack: "Voice is back.", stillDown: "Voice is still unavailable — staying in English text chat.", speakOn: "Spoken replies on", voiceNotice: "If you use the microphone, your recording is sent to Sarvam AI to understand your question.", soon: "PinkyBua is coming soon for your role", speakOff: "Spoken replies off", play: "Play reply" },
  hi: { open: "पिंकी बुआ से पूछें", title: "पिंकी बुआ", placeholder: "समीक्षा के लिए बचे फ़ोटो के बारे में पूछें…", placeholderGuest: "अपने RSVP के बारे में पूछें…", send: "भेजें", thinking: "सोच रही हूँ…", error: "पिंकी बुआ अभी उपलब्ध नहीं हैं। बाकी ऐप चलता रहेगा।", confirm: "पुष्टि करें", cancel: "रद्द करें", done: "हो गया", cancelled: "रद्द किया", hello: "नमस्ते! मैं कैसे मदद करूँ?", mic: "बोलकर पूछें", stop: "रोकें और भेजें", recording: "सुन रही हूँ… भेजने के लिए टैप करें", hearing: "आपका सवाल सुन रही हूँ…", voiceOff: "आवाज़ के लिए सुरक्षित (https) कनेक्शन चाहिए। इस साइट के http पते पर ब्राउज़र माइक्रोफ़ोन बंद रखता है — कृपया लिखकर पूछें।", noMic: "यह ब्राउज़र आवाज़ रिकॉर्ड नहीं कर सकता — कृपया लिखकर पूछें।", micDenied: "माइक्रोफ़ोन की अनुमति नहीं मिली। आवाज़ से पूछने के लिए ब्राउज़र में अनुमति दें।", speakOn: "बोलकर जवाब चालू", voiceNotice: "माइक्रोफ़ोन इस्तेमाल करने पर आपकी रिकॉर्डिंग सवाल समझने के लिए Sarvam AI को भेजी जाती है।", soon: "आपकी भूमिका के लिए पिंकी बुआ जल्द आ रही हैं", speakOff: "बोलकर जवाब बंद", play: "जवाब सुनें" },
} as const;

/**
 * Floating assistant: side panel on desktop, full-width sheet on phones. `inactive` shows the
 * button greyed out ("coming soon") for staff roles PinkyBua is not switched on for yet.
 */
export function PinkyBua({ mode, language = "en", inactive = false }: { mode: "staff" | "guest"; language?: AppLanguage; inactive?: boolean }) {
  if (inactive) {
    return (
      <button disabled title={LABELS.en.soon} aria-label={LABELS.en.soon} className="fixed bottom-4 right-4 z-40 cursor-not-allowed rounded-full bg-stone-300 px-4 py-3 font-semibold text-stone-500 shadow" data-testid="pinkybua-inactive">
        💬 PinkyBua · coming soon
      </button>
    );
  }
  return <ActivePinkyBua mode={mode} language={language} />;
}

function ActivePinkyBua({ mode, language = "en" }: { mode: "staff" | "guest"; language?: AppLanguage }) {
  // When voice AI (Sarvam) is down the widget falls back to the default English text chat.
  const [voiceDown, setVoiceDown] = useState(false);
  const L = LABELS[voiceDown || language !== "hi" ? "en" : "hi"];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bua", text: L.hello }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const recording = useRef<Recording | null>(null);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [rec, setRec] = useState<{ since: number; level: number } | null>(null);
  const [now, setNow] = useState(0);
  const [speak, setSpeak] = useState(true);
  const speakRef = useRef(true);
  speakRef.current = speak; // read by the auto-stop timer
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs, busy]);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => () => recording.current?.cancel(), []);

  const checkVoice = async (): Promise<boolean> => {
    const r = await fetch(`/api/assistant/voice?mode=${mode}`, { cache: "no-store" }).catch(() => null);
    const ok = !!r?.ok && (await r.json().catch(() => null))?.available === true;
    setVoiceDown(!ok);
    return ok;
  };
  const dropToEnglishText = (note: string) => {
    setVoiceDown(true);
    setSpeak(false);
    player.current?.pause();
    setMsgs((m) => [...m.filter((x) => !x.pendingVoice), { from: "system", text: note }]);
  };
  useEffect(() => {
    if (open) void checkVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- check each time the panel opens
  }, [open]);

  const play = (b64: string) => {
    player.current?.pause();
    const a = new Audio(`data:audio/wav;base64,${b64}`);
    player.current = a;
    void a.play().catch(() => {});
  };
  const addReply = (body: Reply) => {
    sessionId.current = body.sessionId;
    setMsgs((m) => [...m, { from: "bua", text: body.text, proposed: body.proposedAction, state: body.proposedAction ? "pending" : undefined, audio: body.audio ?? undefined }]);
  };

  async function toggleMic() {
    if (busy || voiceDown) return;
    if (recording.current) return finishRecording();
    const support = micSupport();
    if (support !== "ok") {
      setMsgs((m) => [...m, { from: "system", text: support === "insecure" ? L.voiceOff : L.noMic }]);
      return;
    }
    player.current?.pause();
    try {
      recording.current = await startRecording((level) => setRec((r) => (r ? { ...r, level } : r)));
      setRec({ since: Date.now(), level: 0 });
      setNow(Date.now());
      autoStop.current = setTimeout(() => void finishRecording(), MAX_SECONDS * 1000);
    } catch (e) {
      recording.current = null;
      setMsgs((m) => [...m, { from: "system", text: (e as Error)?.name === "NotAllowedError" ? L.micDenied : L.noMic }]);
    }
  }

  async function finishRecording() {
    const r = recording.current;
    recording.current = null;
    if (autoStop.current) clearTimeout(autoStop.current);
    setRec(null);
    if (!r) return;
    setBusy(true);
    setMsgs((m) => [...m, { from: "me", text: L.hearing, voice: true, pendingVoice: true }]);
    const dropPending = (m: Msg[]) => m.filter((x) => !x.pendingVoice);
    try {
      const wav = await r.stop();
      const form = new FormData();
      form.append("mode", mode);
      if (sessionId.current) form.append("sessionId", sessionId.current);
      form.append("speak", speakRef.current ? "1" : "0");
      form.append("audio", wav, "question.wav");
      const res = await fetch("/api/assistant/voice", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (Reply & { error?: { message?: string } }) | null;
      if (!res.ok || !body) {
        const code = (body as { error?: { code?: string } } | null)?.error?.code;
        if (code === "VOICE_UNAVAILABLE") return dropToEnglishText(LABELS.en.downBanner);
        setMsgs((m) => [...dropPending(m), { from: "system", text: body?.error?.message ?? L.error }]);
        return;
      }
      setMsgs((m) => m.map((x) => (x.pendingVoice ? { ...x, text: body.transcript ?? "", pendingVoice: false } : x)));
      addReply(body);
      if (speakRef.current && body.audio) play(body.audio);
      if (body.degraded) dropToEnglishText(LABELS.en.downBanner); // text answer delivered, speech failed
    } catch {
      setMsgs((m) => [...dropPending(m), { from: "system", text: L.error }]);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    setMsgs((m) => [...m, { from: "me", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, sessionId: sessionId.current, text: q, ...(voiceDown ? { language: "en" } : {}) }) });
      if (!res.ok) throw new Error(String(res.status));
      addReply((await res.json()) as Reply);
    } catch {
      setMsgs((m) => [...m, { from: "system", text: L.error }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(i: number, p: Proposed, confirm: boolean) {
    setMsgs((m) => m.map((x, k) => (k === i ? { ...x, state: confirm ? "done" : "cancelled" } : x)));
    const res = await fetch(`/api/assistant/${confirm ? "confirm" : "cancel"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, actionId: p.id, token: p.token }) }).catch(() => null);
    if (!res?.ok) {
      const msg = (await res?.json().catch(() => null))?.error?.message ?? L.error;
      setMsgs((m) => [...m.map((x, k) => (k === i ? { ...x, state: "failed" as const } : x)), { from: "system", text: msg }]);
      return;
    }
    if (confirm) router.refresh();
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 rounded-full bg-rose-700 px-4 py-3 font-semibold text-white shadow-lg hover:bg-rose-800" data-testid="pinkybua-open" aria-label={L.open}>
          💬 {L.open}
        </button>
      )}
      {open && (
        <section className="fixed inset-x-0 bottom-0 z-50 flex h-[80dvh] flex-col border-t border-stone-200 bg-white shadow-2xl md:inset-x-auto md:right-4 md:bottom-4 md:h-[34rem] md:w-96 md:rounded-2xl md:border" data-testid="pinkybua-panel" aria-label={L.title}>
          <header className="flex items-center justify-between rounded-t-2xl bg-rose-700 px-4 py-2 text-white">
            <span className="font-semibold">{L.title}</span>
            <span className="flex items-center gap-3">
              <button disabled={voiceDown} onClick={() => setSpeak((v) => !v)} aria-pressed={speak} aria-label={speak ? L.speakOn : L.speakOff} title={speak ? L.speakOn : L.speakOff} className="text-lg leading-none" data-testid="pinkybua-speak-toggle">
                {speak ? "🔊" : "🔇"}
              </button>
              <button onClick={() => (recording.current?.cancel(), (recording.current = null), setRec(null), setOpen(false))} aria-label="Close" className="text-xl leading-none">
                ×
              </button>
            </span>
          </header>
          {voiceDown && (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="pinkybua-voice-down">
              <span className="flex-1">{LABELS.en.downBanner}</span>
              <button
                className="underline"
                onClick={async () => {
                  const ok = await checkVoice();
                  setMsgs((m) => [...m, { from: "system", text: ok ? LABELS.en.voiceBack : LABELS.en.stillDown }]);
                  if (ok) setSpeak(true);
                }}
              >
                {LABELS.en.retryVoice}
              </button>
            </div>
          )}
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={m.from === "me" ? "text-right" : ""}>
                <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left ${m.from === "me" ? "bg-rose-100" : m.from === "system" ? "bg-amber-50 text-amber-900" : "bg-stone-100"}`}>
                  {m.voice && <span aria-hidden>🎤 </span>}
                  {m.text}
                  {m.audio && (
                    <button onClick={() => play(m.audio!)} className="ml-1 align-middle text-xs text-rose-800" aria-label={L.play} title={L.play}>
                      ▶︎
                    </button>
                  )}
                </div>
                {m.proposed && (
                  <div className="mt-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-left" data-testid="pinkybua-confirm-card">
                    <p className="font-medium">{m.proposed.summary}</p>
                    {m.state === "pending" ? (
                      <div className="mt-2 flex gap-2">
                        <button className="btn-primary px-3 py-1 text-sm" onClick={() => decide(i, m.proposed!, true)} data-testid="pinkybua-confirm">
                          {L.confirm}
                        </button>
                        <button className="btn-secondary px-3 py-1 text-sm" onClick={() => decide(i, m.proposed!, false)}>
                          {L.cancel}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-stone-600">{m.state === "done" ? L.done : m.state === "cancelled" ? L.cancelled : "—"}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="text-stone-500" data-testid="pinkybua-thinking">{L.thinking}</p>}
            <div ref={end} />
          </div>
          <form
            className="flex gap-2 border-t border-stone-200 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {rec ? (
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 text-sm text-rose-900" role="status" data-testid="pinkybua-recording">
                <span className="relative inline-flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" style={{ transform: `scale(${1 + rec.level * 2})` }} />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-600" />
                </span>
                <span className="flex-1 truncate">{L.recording}</span>
                <span className="tabular-nums">{Math.min(MAX_SECONDS, Math.floor((now - rec.since) / 1000))}s</span>
              </div>
            ) : (
              <input className="input text-base" value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "guest" ? L.placeholderGuest : L.placeholder} maxLength={2000} data-testid="pinkybua-input" />
            )}
            <button
              type="button"
              onClick={() => void toggleMic()}
              disabled={busy || voiceDown}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${rec ? "border-rose-700 bg-rose-700 text-white" : "border-stone-300 bg-white text-rose-800 hover:bg-rose-50"} disabled:opacity-40`}
              aria-label={rec ? L.stop : L.mic}
              title={voiceDown ? LABELS.en.downBanner : rec ? L.stop : L.mic}
              data-testid="pinkybua-mic"
            >
              {rec ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                </svg>
              )}
            </button>
            {!rec && (
              <button className="btn-primary" disabled={busy || !text.trim()}>
                {L.send}
              </button>
            )}
          </form>
          {mode === "guest" && <p className="px-3 pb-2 text-[11px] text-stone-500" data-testid="pinkybua-voice-notice">{L.voiceNotice}</p>}
        </section>
      )}
    </>
  );
}
