import "server-only";
import { z } from "zod";
import { db, rpc } from "@/lib/db/service";
import { setFeatureEnabled } from "@/lib/flags/admin";
import { flagClient } from "@/lib/flags";

export const RecommendationBody = z.object({
  id: z.string().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(2000),
  proposed_action: z.literal("voice_calls_off"), // the only approved scenario
});

export type Recommendation = {
  id: string;
  external_id: string | null;
  text: string;
  proposed_action: "voice_calls_off";
  status: "pending" | "approved" | "done" | "approved_awaiting_manual_toggle" | "rejected";
  detail: string | null;
  approved_at: string | null;
  verified_at: string | null;
  created_at: string;
};

export async function storeRecommendation(body: z.infer<typeof RecommendationBody>): Promise<{ id: string; duplicate: boolean }> {
  if (body.id) {
    const { data } = await db().from("recommendation").select("id").eq("external_id", body.id).maybeSingle();
    if (data) return { id: data.id, duplicate: true };
  }
  const { data, error } = await db()
    .from("recommendation")
    .insert({ external_id: body.id ?? null, text: body.text, proposed_action: body.proposed_action })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, duplicate: false };
}

export async function listRecommendations(): Promise<Recommendation[]> {
  const { data, error } = await db().from("recommendation").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Recommendation[];
}

export const MANUAL_STEPS =
  "Flagsmith → this environment → Features → voice_calls → switch OFF → Save. The TV will chime instead of speaking within 30 seconds.";

/**
 * Human approval → Flagsmith Admin API sets voice_calls OFF → read back.
 * 'done' only if the read-back says OFF; otherwise 'approved_awaiting_manual_toggle'.
 * Touches nothing else: no restarts, scaling or queue changes.
 */
export async function approveRecommendation(id: string, actorId: string, weddingId: string): Promise<Recommendation> {
  await rpc("recommendation_approve", { p_id: id, p_actor: actorId, p_wedding: weddingId });
  const r = await setFeatureEnabled("voice_calls", false);
  const verifiedOff = r.ok && r.enabled === false;
  if (verifiedOff) flagClient().invalidate();
  const detail = verifiedOff
    ? "voice_calls read back OFF"
    : r.ok
      ? `Read-back still shows ON. ${MANUAL_STEPS}`
      : `Flagsmith Admin API ${r.reason}${r.detail ? ` (${r.detail})` : ""}. ${MANUAL_STEPS}`;
  return rpc<Recommendation>("recommendation_finish", {
    p_id: id,
    p_actor: actorId,
    p_wedding: weddingId,
    p_status: verifiedOff ? "done" : "approved_awaiting_manual_toggle",
    p_detail: detail,
  });
}
