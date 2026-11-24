import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import type { Session } from "@/lib/authz";

/**
 * Gift wishlist (Stage 3 E2 T1). Guests see availability and their own claims only — never who
 * else is bringing what. Hosts (gifts.manage) see claims per family to plan thank-yous.
 */
export const GIFT_BUCKET = "gifts";
export const PRICE_BANDS = ["under_2k", "2k_5k", "5k_10k", "10k_25k", "25k_plus"] as const;
export const PRICE_LABEL: Record<(typeof PRICE_BANDS)[number], string> = { under_2k: "Under ₹2,000", "2k_5k": "₹2,000–5,000", "5k_10k": "₹5,000–10,000", "10k_25k": "₹10,000–25,000", "25k_plus": "₹25,000+" };

export const GiftInput = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  link: z.union([z.literal(""), z.string().trim().url().regex(/^https?:\/\//, "http(s) link")]).optional(),
  priceBand: z.union([z.literal(""), z.enum(PRICE_BANDS)]).optional(),
  quantity: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(["active", "hidden"]).optional(),
  sort: z.coerce.number().int().min(-1000).max(1000).optional(),
  imagePath: z.string().max(300).optional(),
});
export const GiftPatch = GiftInput.partial();

type GiftRow = { id: string; wedding_id: string; title: string; description: string | null; link: string | null; price_band: string | null; image_path: string | null; quantity: number; status: string; sort: number };
type ClaimRow = { id: string; gift_id: string; family_id: string; quantity: number; status: "claimed" | "released" | "fulfilled"; created_at: string; fulfilled_at: string | null };

export type GuestGift = { id: string; title: string; description: string | null; link: string | null; priceBand: string | null; imageUrl: string | null; remaining: number; quantity: number; myClaim: { id: string; quantity: number; status: "claimed" | "fulfilled" } | null };
export type HostGift = Omit<GuestGift, "myClaim"> & { status: string; sort: number; imagePath: string | null; claims: { id: string; familyId: string; familyName: string; quantity: number; status: ClaimRow["status"]; createdAt: string }[] };

async function signedImages(paths: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter(Boolean))] as string[];
  if (!list.length) return new Map();
  const { data } = await db().storage.from(GIFT_BUCKET).createSignedUrls(list, 300);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string] as const));
}

async function giftsWithClaims(weddingId: string, activeOnly: boolean) {
  let q = db().from("gift").select("id, wedding_id, title, description, link, price_band, image_path, quantity, status, sort").eq("wedding_id", weddingId).order("sort").order("title");
  if (activeOnly) q = q.eq("status", "active");
  const { data: gifts, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (gifts ?? []).map((g) => g.id);
  const { data: claims, error: e2 } = ids.length ? await db().from("gift_claim").select("id, gift_id, family_id, quantity, status, created_at, fulfilled_at").in("gift_id", ids).neq("status", "released") : { data: [], error: null };
  if (e2) throw new Error(e2.message);
  return { gifts: (gifts ?? []) as GiftRow[], claims: (claims ?? []) as ClaimRow[] };
}

export async function guestGifts(familyId: string, weddingId: string): Promise<GuestGift[]> {
  const { gifts, claims } = await giftsWithClaims(weddingId, true);
  const urls = await signedImages(gifts.map((g) => g.image_path));
  return gifts.map((g) => {
    const live = claims.filter((c) => c.gift_id === g.id);
    const mine = live.find((c) => c.family_id === familyId);
    return {
      id: g.id,
      title: g.title,
      description: g.description,
      link: g.link,
      priceBand: g.price_band,
      imageUrl: g.image_path ? (urls.get(g.image_path) ?? null) : null,
      quantity: g.quantity,
      remaining: Math.max(0, g.quantity - live.reduce((n, c) => n + c.quantity, 0)),
      myClaim: mine ? { id: mine.id, quantity: mine.quantity, status: mine.status as "claimed" | "fulfilled" } : null,
    };
  });
}

export const claimGift = (familyId: string, giftId: string, quantity: number) => rpc<ClaimRow>("gift_claim_create", { p_family: familyId, p_gift: giftId, p_qty: quantity });
export const releaseClaim = (familyId: string, claimId: string) => rpc<ClaimRow>("gift_claim_release", { p_family: familyId, p_claim: claimId });

export async function hostGifts(weddingId: string): Promise<HostGift[]> {
  const { gifts, claims } = await giftsWithClaims(weddingId, false);
  const famIds = [...new Set(claims.map((c) => c.family_id))];
  const [{ data: fams }, urls] = await Promise.all([famIds.length ? db().from("family").select("id, name").in("id", famIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }), signedImages(gifts.map((g) => g.image_path))]);
  const name = new Map((fams ?? []).map((f) => [f.id, f.name]));
  return gifts.map((g) => {
    const live = claims.filter((c) => c.gift_id === g.id);
    return {
      id: g.id,
      title: g.title,
      description: g.description,
      link: g.link,
      priceBand: g.price_band,
      imageUrl: g.image_path ? (urls.get(g.image_path) ?? null) : null,
      imagePath: g.image_path,
      quantity: g.quantity,
      status: g.status,
      sort: g.sort,
      remaining: Math.max(0, g.quantity - live.reduce((n, c) => n + c.quantity, 0)),
      claims: live.map((c) => ({ id: c.id, familyId: c.family_id, familyName: name.get(c.family_id) ?? "Family", quantity: c.quantity, status: c.status, createdAt: c.created_at })),
    };
  });
}

export async function upsertGift(s: Session, id: string | null, input: z.infer<typeof GiftPatch>) {
  if (input.imagePath && !input.imagePath.startsWith(`${s.weddingId}/`)) throw new AppError("BAD_REQUEST", "Image path is not in this wedding");
  if (!id && !input.title) throw new AppError("BAD_REQUEST", "Title is required");
  return rpc<GiftRow>("gift_upsert", { p_actor: s.userId, p_wedding: s.weddingId, p_id: id, p: input });
}

export async function fulfilClaim(s: Session, claimId: string, fulfilled: boolean) {
  return rpc<ClaimRow>("gift_claim_fulfil", { p_actor: s.userId, p_wedding: s.weddingId, p_claim: claimId, p_fulfilled: fulfilled });
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Signed upload URL into the private bucket; the client then PATCHes the gift with imagePath. */
export async function giftImageUpload(s: Session, giftId: string, contentType: string) {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new AppError("BAD_REQUEST", "JPEG, PNG or WebP only");
  const { data: g } = await db().from("gift").select("id").eq("id", giftId).eq("wedding_id", s.weddingId).maybeSingle();
  if (!g) throw new AppError("NOT_FOUND");
  const path = `${s.weddingId}/${giftId}/${randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(GIFT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`upload url failed: ${error?.message}`);
  return { path, uploadUrl: data.signedUrl, token: data.token };
}

/** PinkyBua (guest): the family's own claims + what is still open. */
export async function listGiftsForFamily(familyId: string, weddingId: string) {
  const gifts = await guestGifts(familyId, weddingId);
  return {
    myClaims: gifts.filter((g) => g.myClaim).map((g) => ({ gift: g.title, quantity: g.myClaim!.quantity, received: g.myClaim!.status === "fulfilled" })),
    available: gifts.filter((g) => g.remaining > 0 && !g.myClaim).map((g) => ({ gift: g.title, remaining: g.remaining })),
  };
}

/** PinkyBua (staff, gifts.manage): totals only. */
export async function giftClaimSummary(weddingId: string) {
  const gifts = await hostGifts(weddingId);
  return {
    gifts: gifts.length,
    fullyClaimed: gifts.filter((g) => g.remaining === 0).length,
    claims: gifts.reduce((n, g) => n + g.claims.length, 0),
    received: gifts.reduce((n, g) => n + g.claims.filter((c) => c.status === "fulfilled").length, 0),
    open: gifts.filter((g) => g.remaining > 0 && g.status === "active").map((g) => ({ gift: g.title, remaining: g.remaining })),
  };
}
