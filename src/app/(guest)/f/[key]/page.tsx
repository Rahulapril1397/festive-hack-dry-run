import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGuest } from "@/domain/rsvp/service";
import { getT } from "@/i18n";
import { LanguageSelect } from "@/i18n/LanguageSelect";
import { RsvpForm } from "./RsvpForm";

export const dynamic = "force-dynamic";

const fmtDate = (d: string | null, lang: string) =>
  d ? new Date(d).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric" }) : null;

export default async function InvitationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) notFound();
  const { family, wedding, events, rsvps } = g;
  const invitation = wedding.invitationText ?? undefined;
  const t = await getT(family.language, wedding.id, invitation ? [invitation] : []);

  return (
    <main className="flex flex-col gap-6">
      <div className="flex justify-end">
        <LanguageSelect value={family.language} label={t("language")} />
      </div>

      <section className="rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm uppercase tracking-widest text-rose-600">{t("invite.title")}</p>
        <h1 className="mt-2 font-serif text-3xl font-bold text-rose-900" data-testid="couple">
          {wedding.coupleNames ?? wedding.name}
        </h1>
        {wedding.weddingDate && (
          <p className="mt-1 text-stone-600">
            {t("invite.date")}: {fmtDate(wedding.weddingDate, family.language)}
          </p>
        )}
        <p className="mt-4 text-stone-700">
          {t("invite.dear")} {family.name},
        </p>
        <p className="mt-1 text-stone-700">{invitation ? t.text(invitation) : t("invite.default")}</p>
      </section>

      <RsvpForm
        events={events.map((e) => ({ ...e, startsLabel: e.startsAt ? new Date(e.startsAt).toLocaleString(family.language === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" }) : null }))}
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

      <p className="rounded-lg bg-stone-100 p-3 text-xs text-stone-600" data-testid="privacy">
        {t("privacy")}
      </p>

      <Link href={`/f/${family.linkKey}/pass`} className="btn-secondary w-full" data-testid="view-pass">
        {t("viewPass")}
      </Link>
    </main>
  );
}
