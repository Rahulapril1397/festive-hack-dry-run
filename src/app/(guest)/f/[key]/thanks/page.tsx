import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGuest } from "@/domain/rsvp/service";
import { openNoteForFamily } from "@/domain/thanks/service";
import { getT } from "@/i18n";

export const dynamic = "force-dynamic";

/** The family's thank-you note (Stage 3 E2 T3). Viewing it records the first open (A/B metric). */
export default async function ThanksPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) notFound();
  const [t, note] = await Promise.all([getT(g.family.language, g.wedding.id), openNoteForFamily(g.family.id)]);
  return (
    <main className="flex flex-col gap-5">
      <Link href={`/f/${g.family.linkKey}/pass`} className="text-sm text-rose-700 underline">
        ← {t("pass.title")}
      </Link>
      <h1 className="font-serif text-3xl font-bold text-rose-900">{t("thanks.title")}</h1>
      {!note ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-500" data-testid="thanks-none">
          {t("thanks.none")}
        </p>
      ) : (
        <article className="overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm" data-testid="thanks-note" lang={note.translated ? note.language : "en"}>
          {note.photoUrl && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket */}
              <img src={note.photoUrl} alt={t("thanks.photo")} className="max-h-96 w-full object-cover" />
            </figure>
          )}
          <p className="whitespace-pre-wrap p-6 font-serif text-lg leading-relaxed text-stone-800">{note.body}</p>
          <p className="px-6 pb-5 text-right text-sm text-rose-800">— {g.wedding.coupleNames ?? g.wedding.name}</p>
        </article>
      )}
    </main>
  );
}
