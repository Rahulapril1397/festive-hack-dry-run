import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGuest, allowedLanguages } from "@/domain/rsvp/service";
import { familyAlbum } from "@/domain/photos/service";
import { getT } from "@/i18n";
import { LanguageSelect } from "@/i18n/LanguageSelect";

export const dynamic = "force-dynamic";

/**
 * The family's own album, opened from their existing family link (one link per family for the whole
 * wedding). Shows only photos a person confirmed for this family, grouped by function.
 */
export default async function AlbumPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) notFound();
  const [t, groups, languages] = await Promise.all([getT(g.family.language, g.wedding.id), familyAlbum(g.family.id), allowedLanguages(g.family)]);
  const eventName = (id: string, fallback: string) => g.events.find((e) => e.id === id)?.name ?? fallback;
  return (
    <main className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link href={`/f/${g.family.linkKey}/pass`} className="text-sm text-rose-700 underline">
          ← {t("pass.title")}
        </Link>
        <LanguageSelect value={g.family.language} label={t("language")} options={languages} />
      </div>
      <h1 className="font-serif text-3xl font-bold text-rose-900">{t("album.title")}</h1>
      <p className="text-sm text-stone-600">{t("album.intro")}</p>
      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-500" data-testid="album-empty">
          {t("album.empty")}
        </p>
      )}
      {groups.map((grp) => (
        <section key={grp.eventId} data-testid="album-group">
          <h2 className="mb-2 font-semibold">{eventName(grp.eventId, grp.eventName)}</h2>
          <div className="grid grid-cols-2 gap-2">
            {grp.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket
              <img key={p.id} src={p.url} alt={t("album.photoAlt")} className="aspect-square w-full rounded-lg object-cover" loading="lazy" data-testid="album-photo" />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
