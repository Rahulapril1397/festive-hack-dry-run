"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Proposed = { id: string; token: string; summary: string; expiresAt: string };
type Msg = { from: "me" | "bua" | "system"; text: string; proposed?: Proposed; state?: "pending" | "done" | "cancelled" | "failed" };

const LABELS = {
  en: { open: "Ask PinkyBua", title: "PinkyBua", placeholder: "Ask about the queue, RSVPs, screens…", send: "Send", thinking: "Thinking…", error: "PinkyBua is not available right now. Everything else keeps working.", confirm: "Confirm", cancel: "Cancel", done: "Done", cancelled: "Cancelled", hello: "Namaste! How can I help?" },
  hi: { open: "पिंकी बुआ से पूछें", title: "पिंकी बुआ", placeholder: "कतार, RSVP के बारे में पूछें…", send: "भेजें", thinking: "सोच रही हूँ…", error: "पिंकी बुआ अभी उपलब्ध नहीं हैं। बाकी ऐप चलता रहेगा।", confirm: "पुष्टि करें", cancel: "रद्द करें", done: "हो गया", cancelled: "रद्द किया", hello: "नमस्ते! मैं कैसे मदद करूँ?" },
} as const;

/** Floating assistant: side panel on desktop, full-width sheet on phones. */
export function PinkyBua({ mode, language = "en" }: { mode: "staff" | "guest"; language?: "en" | "hi" }) {
  const L = LABELS[language];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bua", text: L.hello }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs, busy]);

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    setMsgs((m) => [...m, { from: "me", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, sessionId: sessionId.current, text: q }) });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { sessionId: string; text: string; proposedAction?: Proposed };
      sessionId.current = body.sessionId;
      setMsgs((m) => [...m, { from: "bua", text: body.text, proposed: body.proposedAction, state: body.proposedAction ? "pending" : undefined }]);
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
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-xl leading-none">
              ×
            </button>
          </header>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={m.from === "me" ? "text-right" : ""}>
                <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left ${m.from === "me" ? "bg-rose-100" : m.from === "system" ? "bg-amber-50 text-amber-900" : "bg-stone-100"}`}>{m.text}</div>
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
            <input className="input text-base" value={text} onChange={(e) => setText(e.target.value)} placeholder={L.placeholder} maxLength={2000} data-testid="pinkybua-input" />
            <button className="btn-primary" disabled={busy || !text.trim()}>
              {L.send}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
