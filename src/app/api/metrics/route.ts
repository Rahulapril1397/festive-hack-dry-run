import { timingSafeEqual } from "node:crypto";
import { metrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Prometheus scrape. Authorization: Bearer METRICS_TOKEN. Labels are fixed enums; no PII. */
export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(token);
  const b = Buffer.from(given);
  if (!token || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("unauthorized", { status: 401 });
  return new Response(await metrics.registry.metrics(), { headers: { "content-type": metrics.registry.contentType } });
}
