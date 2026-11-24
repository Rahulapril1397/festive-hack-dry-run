import { loadGuest } from "@/domain/rsvp/service";
import { DemoBanner } from "@/components/shell/DemoBanner";
import { EN } from "@/i18n";
import { PinkyBua } from "@/components/pinkybua/PinkyBua";
import { headers } from "next/headers";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { fromAcceptLanguage } from "@/lib/geo/acceptLanguage";
import { allowedLanguages } from "@/domain/rsvp/service";

export const dynamic = "force-dynamic";

export default async function GuestLayout({ children, params }: { children: React.ReactNode; params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-8 text-center" data-testid="link-invalid">
        <h1 className="text-2xl font-bold text-rose-800">{EN["link.invalid"]}</h1>
        <p className="text-stone-600">{EN["link.invalidHelp"]}</p>
      </main>
    );
  }
  // Step 1 of every family link: choose a language. Until then nothing else is shown, so the rest
  // of the flow (RSVP, pass, wishlist, thank-you, PinkyBua) is always in the family's own language.
  const needsLanguage = g.family.languageSource === "default";
  const languages = needsLanguage ? await allowedLanguages(g.family) : [];
  const suggested = needsLanguage ? fromAcceptLanguage((await headers()).get("accept-language"), languages) : null;
  return (
    <div className="min-h-dvh bg-gradient-to-b from-rose-100 via-amber-50 to-stone-50">
      <div className="toran" aria-hidden />
      <DemoBanner show={g.wedding.isDemo} />
      <div className="mx-auto max-w-md px-4 pb-24 pt-6">
        {needsLanguage ? <LanguagePicker languages={languages} suggested={suggested ?? (languages.includes(g.family.language) && g.family.language !== "en" ? g.family.language : null)} couple={g.wedding.coupleNames ?? g.wedding.name} /> : children}
      </div>
      {!needsLanguage && <PinkyBua mode="guest" language={g.family.language} />}
    </div>
  );
}
