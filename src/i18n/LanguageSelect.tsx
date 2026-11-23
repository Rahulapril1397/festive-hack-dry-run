"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, ENABLED_LANGUAGES, type AppLanguage } from "@/lib/sarvam/languages";

/** Contract C5. Saves the family's language (family.language) and re-renders the page. */
export function LanguageSelect({ value, label }: { value: AppLanguage; label: string }) {
  const router = useRouter();
  const [lang, setLang] = useState(value);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-stone-600">{label}</span>
      <select
        className="rounded-lg border border-stone-300 bg-white px-2 py-1"
        value={lang}
        disabled={pending}
        data-testid="language-select"
        onChange={async (e) => {
          const next = e.target.value as AppLanguage;
          setLang(next);
          await fetch("/api/guest/language", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: next }),
          }).catch(() => {});
          start(() => router.refresh());
        }}
      >
        {ENABLED_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGES[l].native}
          </option>
        ))}
      </select>
    </label>
  );
}
