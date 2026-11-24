import "server-only";
import { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import type { Session } from "@/lib/authz";
import { sarvam } from "@/lib/sarvam/client";
import { isAppLanguage, type AppLanguage } from "@/lib/sarvam/languages";
import { BUCKET as PHOTO_BUCKET } from "@/domain/photos/service";
import { DEFAULT_TEMPLATES, giftSentence, protect, render, restore, variantFor, type Variant } from "./template";

/**
 * Thank-you notes (Stage 3 E2 T2–T3). Only the host-approved template (placeholders as {0}…, no
 * names) is sent to Sarvam for translation; names and gift titles are filled in afterwards.
 */
export const TemplateInput = z.object({ variant: z.enum(["A", "B"]), body: z.string().trim().min(10).max(1500) });
export const GenerateInput = z.object({ familyIds: z.array(z.string().uuid()).max(2000).optional(), onlyAttending: z.boolean().optional() });
export const DraftPatch = z.object({ body: z.string().trim().min(5).max(3000), photoId: z.union([z.literal(""), z.string().uuid()]).optional(), giftClaimId: z.union([z.literal(""), z.string().uuid()]).optional() });
export const SendInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(2000) });

export type NoteRow = {
  id: string;
  family_id: string;
  variant: Variant;
  language: AppLanguage;
  body: string;
  body_en: string;
  translated: boolean;
  photo_id: string | null;
  gift_claim_id: string | null;
  status: "draft" | "sent";
  sent_at: string | null;
  opened_at: string | null;
  open_count: number;
};

export async function getTemplates(weddingId: string): Promise<Record<Variant, string>> {
  const { data } = await db().from("thank_template").select("variant, body").eq("wedding_id", weddingId);
  const out: Record<Variant, string> = { ...DEFAULT_TEMPLATES };
  for (const r of data ?? []) out[r.variant as Variant] = r.body;
  return out;
}

export const setTemplate = (s: Session, variant: Variant, body: string) => rpc("thanks_set_template", { p_actor: s.userId, p_wedding: s.weddingId, p_variant: variant, p_body: body });

/** Translate a template once per (variant, language); null = keep English. */
async function translateTemplate(body: string, lang: AppLanguage): Promise<string | null> {
  if (lang === "en") return body;
  const { text, order } = protect(body);
  try {
    const out = await sarvam().translate(text, lang);
    if (out === text) return null; // Sarvam off: returned unchanged
    return restore(out, order);
  } catch (e) {
    log("WARNING", "thanks translation failed", { lang, error: (e as Error).name });
    return null;
  }
}

/** Create/refresh drafts for families (default: everyone who RSVP'd yes). Sent notes are left alone. */
export async function generateDrafts(s: Session, input: z.infer<typeof GenerateInput>): Promise<{ created: number; untranslated: number; skippedSent: number }> {
  const w = s.weddingId;
  let famQ = db().from("family").select("id, name, language").eq("wedding_id", w);
  if (input.familyIds?.length) famQ = famQ.in("id", input.familyIds);
  const [{ data: fams, error }, { data: wed }, { data: sent }, templates] = await Promise.all([
    famQ,
    db().from("wedding").select("name, couple_names").eq("id", w).single(),
    db().from("thank_note").select("family_id").eq("wedding_id", w).eq("status", "sent"),
    getTemplates(w),
  ]);
  if (error) throw new Error(error.message);
  let families = fams ?? [];
  if (!input.familyIds?.length && input.onlyAttending !== false) {
    const { data: yes } = await db().from("rsvp").select("family_id").eq("status", "yes").in("family_id", families.map((f) => f.id));
    const ids = new Set((yes ?? []).map((r) => r.family_id));
    families = families.filter((f) => ids.has(f.id));
  }
  const sentIds = new Set((sent ?? []).map((r) => r.family_id));
  const todo = families.filter((f) => !sentIds.has(f.id));
  if (!todo.length) return { created: 0, untranslated: 0, skippedSent: families.length - todo.length };

  const ids = todo.map((f) => f.id);
  const [{ data: claims }, { data: photos }] = await Promise.all([
    db().from("gift_claim").select("id, family_id, gift:gift_id(title)").in("family_id", ids).neq("status", "released").order("created_at"),
    db().from("photo").select("id, family_id, corrected_at").in("family_id", ids).eq("review_status", "matched").order("corrected_at", { ascending: true, nullsFirst: false }),
  ]);
  const claimBy = new Map<string, { id: string; title: string }>();
  for (const c of (claims ?? []) as unknown as { id: string; family_id: string; gift: { title: string } | null }[]) if (!claimBy.has(c.family_id)) claimBy.set(c.family_id, { id: c.id, title: c.gift?.title ?? "" });
  const photoBy = new Map<string, string>();
  for (const p of photos ?? []) if (!photoBy.has(p.family_id as string)) photoBy.set(p.family_id as string, p.id as string);

  const cache = new Map<string, string | null>();
  const translated = async (v: Variant, lang: AppLanguage) => {
    const k = `${v}:${lang}`;
    if (!cache.has(k)) cache.set(k, await translateTemplate(templates[v], lang));
    return cache.get(k)!;
  };
  const couple = wed?.couple_names ?? wed?.name ?? "";
  let untranslated = 0;
  for (const f of todo) {
    const variant = variantFor(f.id);
    const lang: AppLanguage = isAppLanguage(f.language) ? f.language : "en";
    const claim = claimBy.get(f.id);
    const vars = { family: f.name, couple, gift: giftSentence(claim?.title) };
    const bodyEn = render(templates[variant], vars);
    const local = await translated(variant, lang);
    // The gift sentence itself stays English inside a translated note only if there is a gift; translate it too when possible.
    const giftLocal = claim?.title && lang !== "en" ? await translateGift(claim.title, lang) : vars.gift;
    const body = local ? render(local, { ...vars, gift: giftLocal }) : bodyEn;
    const ok = lang === "en" || !!local;
    if (!ok) untranslated++;
    await rpc("thanks_save_draft", {
      p_actor: s.userId,
      p_wedding: w,
      p_family: f.id,
      p: { variant, language: lang, body, bodyEn, translated: ok, photoId: photoBy.get(f.id) ?? "", giftClaimId: claim?.id ?? "" },
    });
  }
  return { created: todo.length, untranslated, skippedSent: families.length - todo.length };
}

/** The gift sentence for translated notes: the fixed English sentence is translated with the title protected. */
async function translateGift(title: string, lang: AppLanguage): Promise<string> {
  const sentence = "Thank you also for the {gift}. ";
  const { text, order } = protect(sentence);
  try {
    const out = await sarvam().translate(text, lang);
    const back = out !== text ? restore(out, order) : null;
    return back ? render(back, { gift: title }) + " " : giftSentence(title);
  } catch {
    return giftSentence(title);
  }
}

export type HostNote = NoteRow & { familyName: string; giftTitle: string | null; hasPhoto: boolean };

export async function listNotes(weddingId: string): Promise<HostNote[]> {
  const { data, error } = await db()
    .from("thank_note")
    .select("id, family_id, variant, language, body, body_en, translated, photo_id, gift_claim_id, status, sent_at, opened_at, open_count, family:family_id(name), claim:gift_claim_id(gift:gift_id(title))")
    .eq("wedding_id", weddingId)
    .order("status")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const x = r as unknown as NoteRow & { family: { name: string } | null; claim: { gift: { title: string } | null } | null };
    const { family, claim, ...rest } = x;
    return { ...rest, familyName: family?.name ?? "Family", giftTitle: claim?.gift?.title ?? null, hasPhoto: !!x.photo_id };
  });
}

export async function updateDraft(s: Session, id: string, patch: z.infer<typeof DraftPatch>) {
  const { data: n } = await db().from("thank_note").select("*").eq("id", id).eq("wedding_id", s.weddingId).maybeSingle();
  if (!n) throw new AppError("NOT_FOUND");
  if (n.status !== "draft") throw new AppError("INVALID_TRANSITION", "Already sent");
  return rpc<NoteRow>("thanks_save_draft", {
    p_actor: s.userId,
    p_wedding: s.weddingId,
    p_family: n.family_id,
    p: {
      variant: n.variant,
      language: n.language,
      body: patch.body,
      bodyEn: n.language === "en" ? patch.body : n.body_en,
      translated: n.translated,
      photoId: patch.photoId ?? n.photo_id ?? "",
      giftClaimId: patch.giftClaimId ?? n.gift_claim_id ?? "",
    },
  });
}

export const sendNotes = (s: Session, ids: string[]) => rpc<number>("thanks_send", { p_actor: s.userId, p_wedding: s.weddingId, p_ids: ids });

export type VariantResult = { variant: Variant; sent: number; opened: number; drafts: number; untranslated: number; openRate: number | null };
export async function thankYouResults(weddingId: string): Promise<VariantResult[]> {
  const { data, error } = await db().from("v_thanks_results").select("variant, sent, opened, drafts, untranslated").eq("wedding_id", weddingId);
  if (error) throw new Error(error.message);
  return (["A", "B"] as const).map((v) => {
    const r = (data ?? []).find((x) => x.variant === v) ?? { sent: 0, opened: 0, drafts: 0, untranslated: 0 };
    return { variant: v, sent: r.sent, opened: r.opened, drafts: r.drafts, untranslated: r.untranslated, openRate: r.sent ? r.opened / r.sent : null };
  });
}

/** Guest page: marks the note opened (first open counted once) and returns what to show. */
export async function openNoteForFamily(familyId: string): Promise<{ body: string; translated: boolean; language: AppLanguage; photoUrl: string | null; giftTitle: string | null; sentAt: string } | null> {
  const note = await rpc<NoteRow | null>("thanks_open", { p_family: familyId });
  if (!note?.id) return null;
  let photoUrl: string | null = null;
  if (note.photo_id) {
    const { data: p } = await db().from("photo").select("storage_path, family_id").eq("id", note.photo_id).maybeSingle();
    if (p && p.family_id === familyId) {
      const { data } = await db().storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path as string, 300);
      photoUrl = data?.signedUrl ?? null;
    }
  }
  let giftTitle: string | null = null;
  if (note.gift_claim_id) {
    const { data: c } = await db().from("gift_claim").select("gift:gift_id(title)").eq("id", note.gift_claim_id).maybeSingle();
    giftTitle = (c?.gift as unknown as { title: string } | null)?.title ?? null;
  }
  return { body: note.body, translated: note.translated, language: note.language, photoUrl, giftTitle, sentAt: note.sent_at! };
}

/** Has this family got a sent note, and have they opened it? (pass page badge) */
export async function noteStatusForFamily(familyId: string): Promise<{ sent: boolean; opened: boolean }> {
  const { data } = await db().from("thank_note").select("status, opened_at").eq("family_id", familyId).maybeSingle();
  return { sent: data?.status === "sent", opened: !!data?.opened_at };
}

/** PinkyBua (staff, thanks.manage). */
export async function thankYouStats(weddingId: string) {
  const r = await thankYouResults(weddingId);
  return {
    variants: r.map((x) => ({ variant: x.variant, sent: x.sent, opened: x.opened, openRatePct: x.openRate === null ? null : Math.round(x.openRate * 100), drafts: x.drafts })),
    notTranslated: r.reduce((n, x) => n + x.untranslated, 0),
  };
}
