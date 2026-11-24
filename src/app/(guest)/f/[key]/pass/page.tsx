import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGuest } from "@/domain/rsvp/service";
import { getQueueStatus } from "@/domain/queue";
import { getT } from "@/i18n";
import { LanguageSelect } from "@/i18n/LanguageSelect";
import { PassView } from "./PassView";
import { noteStatusForFamily } from "@/domain/thanks/service";

export const dynamic = "force-dynamic";

/** Private family pass: family name, token, queue position. Only ever this family's own record. */
export default async function PassPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ event?: string }> }) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const g = await loadGuest(key);
  if (!g) notFound();
  const { family, wedding, events } = g;
  const event = events.find((e) => e.id === sp.event) ?? pickDefaultEvent(events);
  const t = await getT(family.language, wedding.id);
  const [status, note] = await Promise.all([event ? getQueueStatus(family.id, event.id) : Promise.resolve(null), noteStatusForFamily(family.id)]);

  return (
    <main className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link href={`/f/${family.linkKey}`} className="text-sm text-rose-700 underline">
          ← {t("backToInvite")}
        </Link>
        <LanguageSelect value={family.language} label={t("language")} />
      </div>
      <section className="rounded-2xl bg-rose-800 p-6 text-white shadow">
        <p className="text-sm uppercase tracking-widest text-rose-200">{t("pass.title")}</p>
        <h1 className="mt-1 text-2xl font-bold" data-testid="pass-family">
          {family.name}
        </h1>
        <p className="text-rose-100">{wedding.coupleNames ?? wedding.name}</p>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label={t("pass.function")}>
        {events.map((e) => (
          <Link
            key={e.id}
            href={`/f/${family.linkKey}/pass?event=${e.id}`}
            className={`rounded-full px-3 py-1 text-sm ${e.id === event?.id ? "bg-rose-700 text-white" : "border border-stone-300 bg-white"}`}
          >
            {e.name}
          </Link>
        ))}
      </nav>

      {event && status && <PassView eventId={event.id} initial={status} labels={t.dict()} />}

      <section className="grid grid-cols-2 gap-3">
        <Link href={`/f/${family.linkKey}/gifts`} className="rounded-xl border border-stone-200 bg-white p-4 text-center hover:border-rose-300" data-testid="pass-gifts">
          <p className="text-2xl" aria-hidden>
            🎁
          </p>
          <p className="font-medium">{t("gifts.title")}</p>
        </Link>
        <Link href={`/f/${family.linkKey}/thanks`} className="relative rounded-xl border border-stone-200 bg-white p-4 text-center hover:border-rose-300" data-testid="pass-thanks">
          {note.sent && !note.opened && <span className="absolute right-2 top-2 rounded-full bg-rose-700 px-2 text-[10px] font-bold uppercase text-white">{t("thanks.new")}</span>}
          <p className="text-2xl" aria-hidden>
            💌
          </p>
          <p className="font-medium">{t("pass.thanks")}</p>
          {!note.sent && <p className="text-xs text-stone-500">{t("comingSoon")}</p>}
        </Link>
      </section>

      {wedding.contactPhone && (
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-sm text-stone-600">{t("contact")}</p>
          <p className="text-lg font-semibold" data-testid="contact-phone">
            {wedding.contactPhone}
          </p>
          <a className="text-sm text-rose-700 underline" href={`tel:${wedding.contactPhone.replace(/\s/g, "")}`}>
            {t("contact")}
          </a>
        </section>
      )}
    </main>
  );
}

function pickDefaultEvent<T extends { startsAt: string | null }>(events: T[]): T | undefined {
  const now = Date.now();
  // the function happening today/next, else the last one
  return events.find((e) => e.startsAt && new Date(e.startsAt).getTime() > now - 12 * 3600_000) ?? events.at(-1);
}
