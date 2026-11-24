import Link from "next/link";
import { notFound } from "next/navigation";
import { loadGuest } from "@/domain/rsvp/service";
import { guestGifts, PRICE_LABEL } from "@/domain/gifts/service";
import { getT } from "@/i18n";
import { LanguageSelect } from "@/i18n/LanguageSelect";
import { GiftList } from "./GiftList";

export const dynamic = "force-dynamic";

/** Guest wishlist (Stage 3 E2 T1). Gift titles are host-entered and shown as typed. */
export default async function GiftsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) notFound();
  const [t, gifts] = await Promise.all([getT(g.family.language, g.wedding.id), guestGifts(g.family.id, g.wedding.id)]);
  return (
    <main className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link href={`/f/${g.family.linkKey}/pass`} className="text-sm text-rose-700 underline">
          ← {t("pass.title")}
        </Link>
        <LanguageSelect value={g.family.language} label={t("language")} />
      </div>
      <h1 className="font-serif text-3xl font-bold text-rose-900">{t("gifts.title")}</h1>
      <p className="text-sm text-stone-600">{t("gifts.intro")}</p>
      <GiftList
        initial={gifts}
        priceLabels={PRICE_LABEL}
        labels={{
          claim: t("gifts.claim"),
          release: t("gifts.release"),
          yours: t("gifts.yours"),
          received: t("gifts.received"),
          taken: t("gifts.taken"),
          left: t("gifts.left"),
          unavailable: t("gifts.unavailable"),
          empty: t("gifts.empty"),
          view: t("gifts.view"),
          error: t("gifts.error"),
        }}
      />
    </main>
  );
}
