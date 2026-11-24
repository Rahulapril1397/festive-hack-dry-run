import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGuest } from "@/domain/rsvp/service";
import { getT } from "@/i18n";
import { LanguageSelect } from "@/i18n/LanguageSelect";
import { allowedLanguages, loadProfile } from "@/domain/rsvp/service";
import { ProfileForm } from "./ProfileForm";
import { LANGUAGES, type AppLanguage } from "@/lib/sarvam/languages";
import { RsvpForm } from "./RsvpForm";
import { Countdown } from "@/components/guest/Countdown";
import { eventKind, LINE_KEY, MEANING_KEY } from "@/components/guest/eventTheme";

export const dynamic = "force-dynamic";

const fmtDate = (d: string | null, lang: AppLanguage) =>
  d ? new Date(d).toLocaleDateString(LANGUAGES[lang].sarvam, { day: "numeric", month: "long", year: "numeric" }) : null;

export default async function InvitationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) notFound();
  const { family, wedding, events, rsvps } = g;
  const invitation = wedding.invitationText ?? undefined;
  const t = await getT(family.language, wedding.id, invitation ? [invitation] : []);

  const profile = await loadProfile(family.id);
  const expected = Math.max(1, ...rsvps.filter((r) => r.status === "yes").map((r) => r.headcount));
  return (
    <main className="flex flex-col gap-6">
      <div className="flex justify-end">
        <LanguageSelect value={family.language} label={t("language")} options={await allowedLanguages(family)} />
      </div>

      <section className="relative overflow-hidden rounded-t-[8rem] rounded-b-2xl border-2 border-amber-400 bg-white/95 px-6 pb-6 pt-10 text-center shadow-md" data-testid="invitation">
        <div className="toran absolute inset-x-0 top-0" aria-hidden />
        <p lang="hi" className="text-lg font-semibold text-amber-700" aria-hidden>
          ॐ श्री गणेशाय नमः
        </p>
        <p className="mt-3 text-xs uppercase tracking-[0.25em] text-rose-700">{t("invite.title")}</p>
        <h1 className="mt-2 font-display text-5xl font-bold leading-tight text-rose-900" data-testid="couple">
          {wedding.coupleNames ?? wedding.name}
        </h1>
        <p className="mt-3 text-sm italic text-stone-600">{t("invite.request")}</p>
        <p className="mt-4 text-stone-800">
          {t("invite.dear")} <span className="font-semibold">{family.name}</span>,
        </p>
        <p className="mt-1 leading-relaxed text-stone-700">{invitation ? t.text(invitation) : t("invite.default")}</p>
        {wedding.weddingDate && (
          <>
            <p className="mt-4 font-display text-xl font-semibold text-rose-800">{fmtDate(wedding.weddingDate, family.language)}</p>
            <Countdown date={wedding.weddingDate} labels={{ days: t("invite.days"), hours: t("invite.hours"), mins: t("invite.mins"), secs: t("invite.secs") }} />
            <p className="mt-2 text-xs uppercase tracking-widest text-amber-700">{t("invite.countdown")}</p>
          </>
        )}
      </section>

      <section className="rounded-2xl border-2 border-dashed border-amber-500 bg-amber-50 p-5 text-center" data-testid="family-token">
        <p className="text-xs uppercase tracking-widest text-amber-800">{t("token.title")}</p>
        <p className="font-display text-7xl font-bold leading-none text-rose-800" data-testid="home-token">
          {family.token ?? "—"}
        </p>
        <p className="mt-2 text-sm text-stone-700">{family.token != null ? t("token.help") : t("token.pending")}</p>
      </section>

      <p className="text-center font-display text-xl text-rose-800">{t("rsvp.joinUs")}</p>

      <RsvpForm
        events={events.map((e) => ({ ...e, line: t(LINE_KEY[eventKind(e.name)]), meaning: t(MEANING_KEY[eventKind(e.name)]), startsLabel: e.startsAt ? new Date(e.startsAt).toLocaleString(LANGUAGES[family.language].sarvam, { dateStyle: "medium", timeStyle: "short" }) : null }))}
        initial={rsvps}
        labels={{
          heading: t("rsvp.heading"),
          attending: t("rsvp.attending"),
          notAttending: t("rsvp.notAttending"),
          headcount: t("rsvp.headcount"),
          save: t("rsvp.save"),
          saving: t("rsvp.saving"),
          saved: t("rsvp.saved"),
          invalid: t("rsvp.invalid"),
          error: t("rsvp.error"),
        }}
      />

      <ProfileForm
        initial={profile}
        defaultCount={expected}
        labels={{
          title: t("trip.title"), intro: t("trip.intro"), travelHeading: t("trip.travel"), mode: t("trip.mode"),
          "mode.train": t("trip.mode.train"), "mode.flight": t("trip.mode.flight"), "mode.car": t("trip.mode.car"), "mode.bus": t("trip.mode.bus"), "mode.other": t("trip.mode.other"),
          trainNo: t("trip.trainNo"), flightNo: t("trip.flightNo"), vehicleNo: t("trip.vehicleNo"), arrival: t("trip.arrival"), count: t("trip.count"),
          foodHeading: t("trip.food"), "food.veg": t("trip.food.veg"), "food.non_veg": t("trip.food.non_veg"), "food.jain": t("trip.food.jain"), "food.vegan": t("trip.food.vegan"),
          foodNote: t("trip.foodNote"), foodNoteHint: t("trip.foodNoteHint"), save: t("trip.save"), saving: t("trip.saving"), saved: t("trip.saved"), invalid: t("trip.invalid"), error: t("trip.error"),
        }}
      />

      <p className="rounded-lg bg-stone-100 p-3 text-xs text-stone-600" data-testid="privacy">
        {t("privacy")}
      </p>

      <Link href={`/f/${family.linkKey}/pass`} className="btn-secondary w-full" data-testid="view-pass">
        {t("viewPass")}
      </Link>
    </main>
  );
}
