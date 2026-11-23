import { handle, json, publicRoute } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/nudgebee/signature";
import { RecommendationBody, storeRecommendation } from "@/lib/nudgebee/service";

/** NudgeBee → us. Signed with NUDGEBEE_WEBHOOK_SECRET. Stores a pending recommendation; never acts on it. */
export const POST = handle(async (req: Request) => {
  publicRoute("HMAC signature + 5-minute timestamp window; stores pending only");
  const raw = await req.text();
  const ok = verifySignature(process.env.NUDGEBEE_WEBHOOK_SECRET ?? "", req.headers.get(SIGNATURE_HEADER), req.headers.get(TIMESTAMP_HEADER), raw);
  if (!ok) throw new AppError("INVALID_SIGNATURE", "Bad or missing signature");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("BAD_REQUEST", "Body must be JSON");
  }
  const body = RecommendationBody.parse(parsed);
  const r = await storeRecommendation(body);
  return json({ id: r.id, status: "pending", duplicate: r.duplicate }, r.duplicate ? 200 : 201);
});
