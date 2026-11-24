import { requirePage } from "@/components/shell/guard";
import { hostGifts, PRICE_LABEL } from "@/domain/gifts/service";
import { GiftsAdmin } from "./GiftsAdmin";

export const dynamic = "force-dynamic";

/** Gift wishlist for hosts (Stage 3 E2 T1): catalogue, who is bringing what, received. */
export default async function HostGiftsPage() {
  const s = await requirePage("gifts.manage", "/host/gifts");
  return <GiftsAdmin initial={await hostGifts(s.weddingId)} priceLabels={PRICE_LABEL} />;
}
