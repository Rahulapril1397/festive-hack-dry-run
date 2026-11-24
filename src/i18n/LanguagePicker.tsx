"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, type AppLanguage } from "@/lib/sarvam/languages";

type Copy = { choose: string; hello: string; more: string; location: string; locating: string; suggestedHere: string; unavailable: string };
/** Shown in English and Hindi at once, because no language has been chosen yet. */
const COPY: Record<"en" | "hi", Copy> = {
  en: { choose: "Choose your language", hello: "You are invited to", more: "More languages", location: "Suggest from my location", locating: "Finding your area…", suggestedHere: "Suggested", unavailable: "Location isn't available — please pick a language." },
  hi: { choose: "अपनी भाषा चुनें", hello: "आप आमंत्रित हैं", more: "अन्य भाषाएँ", location: "मेरी लोकेशन से सुझाव", locating: "आपका क्षेत्र खोज रहे हैं…", suggestedHere: "सुझाव", unavailable: "लोकेशन उपलब्ध नहीं है — कृपया भाषा चुनें।" },
};
const BOTH = (k: keyof Copy) => `${COPY.en[k]} · ${COPY.hi[k]}`;
const PRIMARY: readonly AppLanguage[] = ["en", "hi"];

/**
 * First step of every family link: the guest picks a language and every later screen (invitation,
 * RSVP, pass, album, PinkyBua text and voice) follows it. `languages` is the family's A/B group list:
 * group A gets English and Hindi, group B also gets a dropdown of the other Indian languages.
 * `suggested` is preselected from the browser language; "Suggest from my location" uses rounded
 * coordinates that are never stored.
 */
export function LanguagePicker({ languages, suggested, couple }: { languages: readonly AppLanguage[]; suggested: AppLanguage | null; couple: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hint, setHint] = useState<AppLanguage | null>(suggested);
  const [note, setNote] = useState<string | null>(null);
  const [chosen, setChosen] = useState<AppLanguage | null>(null);
  const buttons = languages.filter((l) => PRIMARY.includes(l));
  const more = languages.filter((l) => !PRIMARY.includes(l));

  const pick = async (language: AppLanguage) => {
    setChosen(language);
    await fetch("/api/guest/language", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language, source: hint === language ? "browser" : "manual" }) }).catch(() => {});
    start(() => router.refresh());
  };
  const locate = () => {
    if (!("geolocation" in navigator) || !window.isSecureContext) return setNote(BOTH("unavailable"));
    setNote(BOTH("locating"));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Math.round(pos.coords.latitude * 10) / 10; // ~10 km, rounded before it leaves the phone
        const lon = Math.round(pos.coords.longitude * 10) / 10;
        const r = await fetch("/api/guest/language/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat, lon }) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        const l = r?.language as AppLanguage | null;
        if (l && languages.includes(l)) setHint(l);
        setNote(null);
      },
      () => setNote(BOTH("unavailable")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <main className="flex min-h-[70dvh] flex-col justify-center gap-6 text-center" data-testid="language-picker">
      <div>
        <p className="text-4xl" aria-hidden>🪔</p>
        <p className="mt-1 text-sm uppercase tracking-widest text-rose-600">{BOTH("hello")}</p>
        <h1 className="mt-2 font-display text-5xl font-bold text-rose-900">{couple}</h1>
      </div>
      <section className="card border-amber-300 p-6">
        <h2 className="text-lg font-semibold">{BOTH("choose")}</h2>
        <div className="mt-4 grid gap-3">
          {buttons.map((l) => (
            <button
              key={l}
              lang={l}
              disabled={pending}
              onClick={() => void pick(l)}
              data-testid={`pick-${l}`}
              className={`relative rounded-xl border-2 px-4 py-4 text-2xl font-semibold transition ${hint === l ? "border-rose-600 bg-rose-50" : "border-stone-200 bg-white hover:border-rose-300"} ${chosen === l ? "opacity-60" : ""}`}
            >
              {LANGUAGES[l].native}
              {hint === l && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-normal text-rose-700">★ {BOTH("suggestedHere")}</span>}
            </button>
          ))}
          {more.length > 0 && (
            <label className="text-left text-sm text-stone-600">
              {BOTH("more")}
              <select
                data-testid="pick-more"
                disabled={pending}
                value={hint && more.includes(hint) ? hint : ""}
                onChange={(e) => e.target.value && void pick(e.target.value as AppLanguage)}
                className={`mt-1 w-full rounded-xl border-2 bg-white px-3 py-3 text-lg ${hint && more.includes(hint) ? "border-rose-600" : "border-stone-200"}`}
              >
                <option value="">—</option>
                {more.map((l) => (
                  <option key={l} value={l} lang={l}>
                    {LANGUAGES[l].native} · {LANGUAGES[l].label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button onClick={locate} className="mt-4 text-sm text-rose-800 underline">
          📍 {BOTH("location")}
        </button>
        {note && <p className="mt-1 text-xs text-stone-600">{note}</p>}
      </section>
    </main>
  );
}
