"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, type AppLanguage } from "@/lib/sarvam/languages";

type Labels = Record<"suggest" | "switch" | "notNow" | "useLocation" | "locating" | "noMatch" | "denied" | "privacy", string>;

/**
 * Stage 3 E2 T4: suggests a language from the browser (server-side Accept-Language) or, on tap,
 * from coarse location. Shown only while the family has never picked a language.
 */
export function LanguageHint({ current, suggestion, labels }: { current: AppLanguage; suggestion: AppLanguage | null; labels: Labels }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [suggested, setSuggested] = useState<{ lang: AppLanguage; source: "browser" | "location" } | null>(suggestion ? { lang: suggestion, source: "browser" } : null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (hidden) return null;

  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const accept = async () => {
    if (!suggested) return;
    await post("/api/guest/language", { language: suggested.lang, source: suggested.source }).catch(() => {});
    setHidden(true);
    start(() => router.refresh());
  };
  const dismiss = async () => {
    setHidden(true);
    await post("/api/guest/language/dismiss", {}).catch(() => {});
  };
  const locate = () => {
    if (!("geolocation" in navigator) || !window.isSecureContext) return setNote(labels.denied);
    setNote(labels.locating);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Math.round(pos.coords.latitude * 10) / 10; // ~10 km, rounded before it leaves the phone
        const lon = Math.round(pos.coords.longitude * 10) / 10;
        const r = await post("/api/guest/language/suggest", { lat, lon }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (r?.language && r.language !== current) {
          setSuggested({ lang: r.language, source: "location" });
          setNote(null);
        } else setNote(labels.noMatch);
      },
      () => setNote(labels.denied),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <section className="rounded-xl border border-rose-200 bg-white p-3 text-sm" data-testid="language-hint" aria-live="polite">
      {suggested ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {labels.suggest} <b lang={suggested.lang}>{LANGUAGES[suggested.lang].native}</b>?
          </span>
          <span className="flex-1" />
          <button className="btn-primary !px-3 !py-1 text-sm" onClick={accept} disabled={pending} data-testid="language-hint-accept">
            {labels.switch}
          </button>
          <button className="btn-secondary !px-3 !py-1 text-sm" onClick={dismiss}>
            {labels.notNow}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button className="text-rose-800 underline" onClick={locate}>
            📍 {labels.useLocation}
          </button>
          <span className="flex-1" />
          <button className="text-xs text-stone-500 underline" onClick={dismiss}>
            {labels.notNow}
          </button>
        </div>
      )}
      {note && <p className="mt-1 text-xs text-stone-600">{note}</p>}
      {!suggested && <p className="mt-1 text-[11px] text-stone-400">{labels.privacy}</p>}
    </section>
  );
}
